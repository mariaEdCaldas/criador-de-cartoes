import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CAMINHOS = {
  config: path.join(RAIZ, 'config.json'),
  dados: path.join(RAIZ, 'dados'),
  aniversariantes: path.join(RAIZ, 'dados', 'aniversariantes.json'),
  enviados: path.join(RAIZ, 'dados', 'enviados.json'),
  generoManual: path.join(RAIZ, 'dados', 'genero-manual.json'),
  sessaoWhatsapp: path.join(RAIZ, 'dados', 'sessao-whatsapp'),
  cartoes: path.join(RAIZ, 'cartoes'),
  uploads: path.join(RAIZ, 'dados', 'uploads'),
  assets: path.join(RAIZ, 'assets'),
};

for (const dir of [CAMINHOS.dados, CAMINHOS.cartoes, CAMINHOS.uploads, CAMINHOS.assets]) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Mescla raso de dois niveis, suficiente para o formato do config.json. */
function mesclar(padrao, usuario) {
  const saida = { ...padrao };
  for (const [chave, valor] of Object.entries(usuario ?? {})) {
    saida[chave] =
      valor && typeof valor === 'object' && !Array.isArray(valor)
        ? mesclar(padrao[chave] ?? {}, valor)
        : valor;
  }
  return saida;
}

const PADRAO = {
  cartao: {
    template: 'assets/template.png',
    texto: '{tratamento} {nome}!',
    usarPrimeiroNome: true,
    fonte: {
      arquivo: '',
      familia: 'Arial',
      estilo: 'italic',
      peso: 'bold',
      tamanho: 0.045,
      cor: '#FFFFFF',
      sombra: { cor: 'rgba(0,0,0,0.45)', desfoque: 0.012, deslocamentoX: 0.003, deslocamentoY: 0.004 },
    },
    posicao: { x: 0.735, y: 0.375, alinhamento: 'center', larguraMaxima: 0.5 },
  },
  mensagem: {
    legenda: 'Feliz aniversário, {nome}! 🎉',
    enviarLegenda: true,
  },
  envio: {
    horario: '08:00',
    fusoHorario: 'America/Campo_Grande',
    automatico: false,
    intervaloMinimoSegundos: 25,
    intervaloMaximoSegundos: 70,
    limiteDiario: 120,
    dddPadrao: '67',
    paisPadrao: '55',
  },
  servidor: { porta: 3000 },
};

export function lerConfig() {
  let doArquivo = {};
  if (fs.existsSync(CAMINHOS.config)) {
    doArquivo = JSON.parse(fs.readFileSync(CAMINHOS.config, 'utf8'));
  }
  return mesclar(PADRAO, doArquivo);
}

export function salvarConfig(config) {
  fs.writeFileSync(CAMINHOS.config, JSON.stringify(config, null, 2) + '\n');
  return config;
}
