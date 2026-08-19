import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { CAMINHOS, RAIZ } from './config.js';
import { primeiroNome, tratamento } from './genero.js';

let fonteRegistrada = null;

function registrarFonte(config) {
  const arquivo = config.cartao.fonte.arquivo;
  if (!arquivo) return config.cartao.fonte.familia;
  const caminho = path.isAbsolute(arquivo) ? arquivo : path.join(RAIZ, arquivo);
  if (!fs.existsSync(caminho)) {
    throw new Error(`Fonte nao encontrada: ${caminho}`);
  }
  if (fonteRegistrada !== caminho) {
    GlobalFonts.registerFromPath(caminho, 'FonteCartao');
    fonteRegistrada = caminho;
  }
  return 'FonteCartao';
}

export function textoDoCartao(pessoa, config) {
  const nome = config.cartao.usarPrimeiroNome ? primeiroNome(pessoa.nome) : pessoa.nome;
  return config.cartao.texto
    .replace('{tratamento}', tratamento(pessoa.genero))
    .replace('{nome}', nome);
}

export function caminhoTemplate(config) {
  const t = config.cartao.template;
  return path.isAbsolute(t) ? t : path.join(RAIZ, t);
}

/**
 * Escreve o nome sobre a arte. Todas as medidas do config sao fracoes da
 * largura/altura da imagem, entao o mesmo ajuste vale para qualquer resolucao
 * de template.
 */
export async function gerarCartao(pessoa, config, opcoes = {}) {
  const template = caminhoTemplate(config);
  if (!fs.existsSync(template)) {
    throw new Error(
      `Template nao encontrado em "${template}". Coloque a arte em branco do cartao nesse caminho.`,
    );
  }

  const familia = registrarFonte(config);
  const imagem = await loadImage(template);
  const canvas = createCanvas(imagem.width, imagem.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imagem, 0, 0);

  const { fonte, posicao } = config.cartao;
  const texto = opcoes.texto ?? textoDoCartao(pessoa, config);
  const x = (opcoes.x ?? posicao.x) * imagem.width;
  const y = (opcoes.y ?? posicao.y) * imagem.height;
  const larguraMaxima = (opcoes.larguraMaxima ?? posicao.larguraMaxima) * imagem.width;

  let tamanho = (opcoes.tamanho ?? fonte.tamanho) * imagem.height;
  const montarFonte = (px) => `${fonte.estilo} ${fonte.peso} ${Math.round(px)}px "${familia}"`;

  ctx.font = montarFonte(tamanho);
  // Diminui a fonte ate o nome caber na area reservada.
  while (ctx.measureText(texto).width > larguraMaxima && tamanho > 12) {
    tamanho -= 1;
    ctx.font = montarFonte(tamanho);
  }

  ctx.textAlign = posicao.alinhamento;
  ctx.textBaseline = 'alphabetic';

  if (fonte.sombra) {
    ctx.shadowColor = fonte.sombra.cor;
    ctx.shadowBlur = fonte.sombra.desfoque * imagem.height;
    ctx.shadowOffsetX = fonte.sombra.deslocamentoX * imagem.width;
    ctx.shadowOffsetY = fonte.sombra.deslocamentoY * imagem.height;
  }
  ctx.fillStyle = fonte.cor;
  ctx.fillText(texto, x, y);

  const png = canvas.toBuffer('image/png');
  if (opcoes.apenasBuffer) return { buffer: png, texto };

  const nomeArquivo = `${pessoa.id ?? `${pessoa.dia}-${primeiroNome(pessoa.nome)}`}.png`
    .replace(/[^a-zA-Z0-9.\-_]/g, '-');
  const destino = path.join(CAMINHOS.cartoes, nomeArquivo);
  fs.writeFileSync(destino, png);
  return { arquivo: destino, buffer: png, texto };
}

export function fontesDisponiveis() {
  return [...new Set(GlobalFonts.families.map((f) => f.family))].sort();
}
