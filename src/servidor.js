import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { CAMINHOS, RAIZ, lerConfig, salvarConfig } from './config.js';
import { importarPdf } from './parser.js';
import {
  importarParaBase, lerBase, salvarBase, lerEnviados,
  adicionarPessoa, removerPessoa, normalizarTelefone,
} from './db.js';
import { gerarCartao, fontesDisponiveis, caminhoTemplate } from './cartao.js';
import { salvarGeneroManual } from './genero.js';
import { whatsapp } from './whatsapp.js';
import { enviarDoDia, estadoDaRodada, previaDoDia } from './envio.js';
import { iniciarAgenda } from './agenda.js';
import {
  autenticar, gerarToken, definirCookie, limparCookie, usuarioDaRequisicao,
  exigirLogin, exigirAdmin, listarUsuarios, criarUsuario, removerUsuario, trocarSenha,
} from './auth.js';

const upload = multer({ dest: CAMINHOS.uploads });

function dataDaQuery(query) {
  if (!query.data) return new Date();
  const [ano, mes, dia] = String(query.data).split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

export function criarServidor() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.post('/api/login', (req, res) => {
    const usuario = autenticar(req.body?.email, req.body?.senha);
    if (!usuario) return res.status(401).json({ ok: false, erro: 'E-mail ou senha incorretos.' });
    definirCookie(req, res, gerarToken(usuario));
    res.json({ ok: true, usuario: { email: usuario.email, admin: usuario.admin } });
  });

  app.post('/api/logout', (req, res) => {
    limparCookie(res);
    res.json({ ok: true });
  });

  // Daqui para baixo, tudo exige sessao valida.
  app.use('/api', exigirLogin);

  app.get('/api/eu', (req, res) => {
    res.json({ email: req.usuario.email, admin: req.usuario.admin, id: req.usuario.id });
  });

  app.get('/api/usuarios', exigirAdmin, (req, res) => {
    res.json({ usuarios: listarUsuarios() });
  });

  app.post('/api/usuarios', exigirAdmin, (req, res) => {
    try {
      res.json({ ok: true, usuario: criarUsuario(req.body ?? {}) });
    } catch (erro) {
      res.status(400).json({ ok: false, erro: erro.message });
    }
  });

  app.delete('/api/usuarios/:id', exigirAdmin, (req, res) => {
    try {
      if (req.params.id === req.usuario.id) throw new Error('Você não pode remover a si mesmo.');
      res.json({ ok: true, usuario: removerUsuario(req.params.id) });
    } catch (erro) {
      res.status(400).json({ ok: false, erro: erro.message });
    }
  });

  app.post('/api/senha', (req, res) => {
    try {
      trocarSenha(req.usuario.id, req.body?.atual, req.body?.nova);
      res.json({ ok: true });
    } catch (erro) {
      res.status(400).json({ ok: false, erro: erro.message });
    }
  });

  // O painel em si tambem so abre logado; a tela de login segue publica.
  app.use((req, res, next) => {
    const protegido = req.path === '/' || req.path === '/index.html';
    if (protegido && !usuarioDaRequisicao(req)) return res.redirect('/login.html');
    next();
  });
  app.use(express.static(path.join(RAIZ, 'src', 'publico')));

  app.get('/api/estado', async (req, res) => {
    const base = lerBase();
    const config = lerConfig();
    const wa = whatsapp.resumo();
    res.json({
      base: {
        mes: base.mes,
        mesNome: base.mesNome,
        importadoEm: base.importadoEm,
        arquivo: base.arquivo ? path.basename(base.arquivo) : null,
        total: base.pessoas.length,
        semTelefone: base.pessoas.filter((p) => !p.telefone).length,
        generoIncerto: base.pessoas.filter((p) => p.generoConfianca !== 'alta').length,
        // Dias que o PDF importado realmente cobre: o painel usa isso para
        // explicar uma fila vazia em vez de so mostrar "ninguem".
        dias: [...new Set(base.pessoas.map((p) => p.dia))].sort((a, b) => a - b),
      },
      config,
      whatsapp: { ...wa, qr: wa.qr ? await QRCode.toDataURL(wa.qr, { width: 320 }) : null },
      rodada: estadoDaRodada(),
      templateExiste: fs.existsSync(caminhoTemplate(config)),
      fontes: fontesDisponiveis(),
      hoje: new Date().toISOString().slice(0, 10),
    });
  });

  app.post('/api/importar', upload.single('pdf'), async (req, res) => {
    try {
      if (!req.file) throw new Error('Nenhum arquivo enviado.');
      const config = lerConfig();
      const destino = path.join(CAMINHOS.uploads, req.file.originalname);
      fs.renameSync(req.file.path, destino);
      const resultado = await importarPdf(destino, {
        dddPadrao: config.envio.dddPadrao,
        paisPadrao: config.envio.paisPadrao,
      });
      const base = importarParaBase(resultado);
      res.json({ ok: true, total: base.pessoas.length, mes: base.mesNome, avisos: resultado.avisos });
    } catch (erro) {
      res.status(400).json({ ok: false, erro: erro.message });
    }
  });

  app.get('/api/pessoas', (req, res) => {
    const base = lerBase();
    let pessoas = base.pessoas;
    if (req.query.dia) pessoas = pessoas.filter((p) => p.dia === Number(req.query.dia));
    if (req.query.busca) {
      const busca = String(req.query.busca).toLowerCase();
      pessoas = pessoas.filter((p) => p.nome.toLowerCase().includes(busca));
    }
    if (req.query.problemas === '1') pessoas = pessoas.filter((p) => p.problemas?.length);
    res.json({ pessoas, mes: base.mes });
  });

  app.patch('/api/pessoas/:id', (req, res) => {
    const base = lerBase();
    const pessoa = base.pessoas.find((p) => p.id === req.params.id);
    if (!pessoa) return res.status(404).json({ erro: 'Pessoa nao encontrada.' });

    const { genero, telefone, ativo, nome } = req.body;
    if (genero && genero !== pessoa.genero) {
      pessoa.genero = genero;
      pessoa.generoOrigem = 'manual';
      pessoa.generoConfianca = 'alta';
      // A correcao vira dicionario: no mes que vem esse nome ja sai certo.
      salvarGeneroManual(pessoa.nome, genero);
    }
    if (telefone !== undefined) pessoa.telefone = normalizarTelefone(telefone);
    if (ativo !== undefined) pessoa.ativo = Boolean(ativo);
    if (nome) pessoa.nome = nome;
    pessoa.editado = true;
    pessoa.problemas = (pessoa.problemas ?? []).filter((p) => !p.startsWith('genero incerto'));
    if (!pessoa.telefone && !pessoa.problemas.includes('sem telefone')) pessoa.problemas.push('sem telefone');
    if (pessoa.telefone) pessoa.problemas = pessoa.problemas.filter((p) => p !== 'sem telefone');

    salvarBase(base);
    res.json({ ok: true, pessoa });
  });

  app.post('/api/pessoas', (req, res) => {
    try {
      res.json({ ok: true, pessoa: adicionarPessoa(req.body ?? {}) });
    } catch (erro) {
      res.status(400).json({ ok: false, erro: erro.message });
    }
  });

  app.delete('/api/pessoas/:id', (req, res) => {
    try {
      res.json({ ok: true, pessoa: removerPessoa(req.params.id) });
    } catch (erro) {
      res.status(400).json({ ok: false, erro: erro.message });
    }
  });

  app.get('/api/cartao/:id.png', async (req, res) => {
    try {
      const base = lerBase();
      const pessoa = base.pessoas.find((p) => p.id === req.params.id);
      if (!pessoa) return res.status(404).send('Pessoa nao encontrada.');
      const config = lerConfig();
      const { buffer } = await gerarCartao(pessoa, config, {
        apenasBuffer: true,
        x: req.query.x ? Number(req.query.x) : undefined,
        y: req.query.y ? Number(req.query.y) : undefined,
        tamanho: req.query.tamanho ? Number(req.query.tamanho) : undefined,
      });
      res.type('png').send(buffer);
    } catch (erro) {
      res.status(400).send(erro.message);
    }
  });

  app.get('/api/cartao-exemplo.png', async (req, res) => {
    try {
      const config = lerConfig();
      const pessoa = { nome: req.query.nome || 'Elaine Camargo', genero: req.query.genero || 'F', dia: 1 };
      const { buffer } = await gerarCartao(pessoa, config, {
        apenasBuffer: true,
        x: req.query.x ? Number(req.query.x) : undefined,
        y: req.query.y ? Number(req.query.y) : undefined,
        tamanho: req.query.tamanho ? Number(req.query.tamanho) : undefined,
      });
      res.type('png').send(buffer);
    } catch (erro) {
      res.status(400).send(erro.message);
    }
  });

  app.post('/api/config', (req, res) => {
    try {
      const config = lerConfig();
      const novo = { ...config };
      for (const [secao, valores] of Object.entries(req.body ?? {})) {
        novo[secao] = { ...(config[secao] ?? {}), ...valores };
        for (const [chave, valor] of Object.entries(valores ?? {})) {
          if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
            novo[secao][chave] = { ...(config[secao]?.[chave] ?? {}), ...valor };
          }
        }
      }
      salvarConfig(novo);
      iniciarAgenda();
      res.json({ ok: true, config: novo });
    } catch (erro) {
      res.status(400).json({ ok: false, erro: erro.message });
    }
  });

  app.post('/api/whatsapp/conectar', async (req, res) => {
    try {
      whatsapp.conectar().catch(() => {});
      res.json({ ok: true });
    } catch (erro) {
      res.status(400).json({ ok: false, erro: erro.message });
    }
  });

  app.post('/api/whatsapp/desconectar', async (req, res) => {
    await whatsapp.desconectar();
    res.json({ ok: true });
  });

  app.get('/api/fila', (req, res) => {
    res.json({ fila: previaDoDia(dataDaQuery(req.query)) });
  });

  app.post('/api/enviar', async (req, res) => {
    try {
      const data = req.body?.data ? dataDaQuery(req.body) : new Date();
      // Nao aguarda o fim: a rodada e acompanhada por /api/estado.
      enviarDoDia({ data, simulacao: Boolean(req.body?.simulacao), ids: req.body?.ids ?? null })
        .catch((erro) => console.error('[envio]', erro.message));
      res.json({ ok: true });
    } catch (erro) {
      res.status(400).json({ ok: false, erro: erro.message });
    }
  });

  app.get('/api/enviados', (req, res) => {
    res.json({ enviados: lerEnviados().slice(-500).reverse() });
  });

  return app;
}
