#!/usr/bin/env node
import path from 'node:path';
import { lerConfig, CAMINHOS } from './config.js';
import { importarPdf } from './parser.js';
import { importarParaBase, lerBase } from './db.js';
import { gerarCartao } from './cartao.js';
import { criarServidor } from './servidor.js';
import { iniciarAgenda } from './agenda.js';
import { enviarDoDia, previaDoDia } from './envio.js';
import { whatsapp } from './whatsapp.js';
import { criarUsuario, listarUsuarios, semearAdmin } from './auth.js';

const [, , comando, ...argumentos] = process.argv;
const config = lerConfig();

function argumento(nome, padrao = null) {
  const achado = argumentos.find((a) => a.startsWith(`--${nome}=`));
  return achado ? achado.split('=').slice(1).join('=') : padrao;
}

function dataDoArgumento() {
  const bruto = argumento('data');
  if (!bruto) return new Date();
  const [ano, mes, dia] = bruto.split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

async function esperarConexao() {
  await whatsapp.conectar();
  if (whatsapp.estado === 'conectado') return;
  console.log('Aguardando o WhatsApp conectar… (leia o QR code se ele aparecer)');
  const qrterminal = await import('qrcode').then((m) => m.default);
  whatsapp.on('estado', async (resumo) => {
    if (resumo.qr) console.log(await qrterminal.toString(resumo.qr, { type: 'terminal', small: true }));
  });
  await new Promise((resolver) => {
    const checar = () => (whatsapp.estado === 'conectado' ? resolver() : setTimeout(checar, 1000));
    checar();
  });
  console.log('WhatsApp conectado.');
}

const comandos = {
  async importar() {
    const arquivo = argumentos.find((a) => !a.startsWith('--'));
    if (!arquivo) return console.error('Uso: npm run importar -- caminho/do/arquivo.pdf');
    const resultado = await importarPdf(path.resolve(arquivo), {
      dddPadrao: config.envio.dddPadrao,
      paisPadrao: config.envio.paisPadrao,
    });
    const base = importarParaBase(resultado);
    const semTelefone = base.pessoas.filter((p) => !p.telefone);
    console.log(`Importados ${base.pessoas.length} aniversariantes de ${base.mesNome}.`);
    console.log(`Com telefone: ${base.pessoas.length - semTelefone.length} | sem telefone: ${semTelefone.length}`);
    if (semTelefone.length) console.log('Sem telefone: ' + semTelefone.map((p) => p.nome).join(', '));
  },

  async gerar() {
    const data = dataDoArgumento();
    const fila = previaDoDia(data);
    if (!fila.length) return console.log('Ninguem faz aniversario nessa data.');
    for (const item of fila) {
      const { arquivo } = await gerarCartao(item.pessoa, config);
      console.log(`${item.pessoa.nome} -> ${arquivo}  ("${item.textoCartao}")`);
    }
    console.log(`\n${fila.length} cartao(oes) em ${CAMINHOS.cartoes}`);
  },

  async preview() {
    const nome = argumento('nome', 'Elaine Camargo');
    const genero = argumento('genero', 'F');
    const { arquivo, texto } = await gerarCartao({ nome, genero, dia: 0, id: 'preview' }, config);
    console.log(`Cartao de teste ("${texto}") salvo em ${arquivo}`);
  },

  async enviar() {
    const simulacao = argumentos.includes('--simular');
    const data = dataDoArgumento();
    if (!simulacao) await esperarConexao();
    const resultado = await enviarDoDia({ data, simulacao });
    const ok = resultado.itens.filter((i) => i.status === 'enviado' || i.status === 'simulado').length;
    console.log(`\n${ok}/${resultado.total} concluidos${simulacao ? ' (simulacao)' : ''}.`);
    for (const item of resultado.itens.filter((i) => i.status === 'erro')) {
      console.log(`  erro em ${item.nome}: ${item.erro}`);
    }
    if (!simulacao) await whatsapp.desconectar();
    process.exit(0);
  },

  async lista() {
    const base = lerBase();
    console.log(`${base.pessoas.length} aniversariantes de ${base.mesNome ?? '—'}`);
    for (const p of base.pessoas) {
      console.log(`  dia ${String(p.dia).padStart(2, '0')}  ${p.genero}  ${p.nome} — ${p.telefone ?? 'SEM TELEFONE'}`);
    }
  },

  async usuario() {
    const email = argumento('email');
    const senha = argumento('senha');
    if (!email || !senha) {
      console.log('Usuarios cadastrados:');
      for (const u of listarUsuarios()) {
        console.log(`  ${u.email}${u.admin ? '  (administrador)' : ''}`);
      }
      console.log('');
      console.log('Para cadastrar: node src/index.js usuario --email=... --senha=... --admin');
      return;
    }
    const novo = criarUsuario({ email, senha, admin: argumentos.includes('--admin') });
    console.log(`Usuario ${novo.email} criado${novo.admin ? ' como administrador' : ''}.`);
  },

  async servidor() {
    semearAdmin();
    const app = criarServidor();
    const porta = Number(argumento('porta', config.servidor.porta));
    app.listen(porta, () => {
      console.log(`\n  Painel:  http://localhost:${porta}\n`);
      iniciarAgenda();
    });
  },
};

const escolhido = comandos[comando ?? 'servidor'];
if (!escolhido) {
  console.log(`Comandos:
  npm start                              abre o painel web (importar, ajustar, enviar)
  npm run importar -- arquivo.pdf        importa o PDF do mes
  npm run gerar -- --data=2026-08-20     gera os cartoes do dia na pasta cartoes/
  npm run preview -- --nome=Joao --genero=M   gera um cartao de teste
  npm run enviar -- --simular            simula o envio do dia (nao manda nada)
  npm run enviar                         envia os cartoes de hoje pelo WhatsApp
  node src/index.js lista                mostra a lista importada
  node src/index.js usuario              lista quem tem acesso ao painel
  node src/index.js usuario --email=a@b.com --senha=... --admin   cadastra alguem`);
  process.exit(1);
}

escolhido().catch((erro) => {
  console.error('Erro:', erro.message);
  process.exit(1);
});
