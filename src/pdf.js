import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * Extrai o texto do PDF preservando as colunas: devolve uma lista de linhas
 * visuais, cada uma com os pedacos de texto e a posicao horizontal deles.
 * A posicao importa para ler tabelas, onde cada coluna cai num x diferente.
 */
export async function extrairFragmentos(caminhoPdf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // No Windows o pdf.js precisa de uma URL file:// para carregar o worker.
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ).href;

  const buffer = await fs.readFile(caminhoPdf);
  const documento = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;

  const linhas = [];
  for (let numero = 1; numero <= documento.numPages; numero++) {
    const pagina = await documento.getPage(numero);
    const conteudo = await pagina.getTextContent();

    const porLinha = new Map();
    for (const item of conteudo.items) {
      if (!item.str || !item.str.trim()) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      // Arredonda o Y para juntar pedacos da mesma linha visual.
      const chave = Math.round(y / 3);
      if (!porLinha.has(chave)) porLinha.set(chave, []);
      porLinha.get(chave).push({ x, texto: item.str, largura: item.width ?? 0 });
    }

    const ordenadas = [...porLinha.entries()]
      .sort((a, b) => b[0] - a[0]) // do topo para o rodape
      .map(([, fragmentos]) => agrupar(fragmentos))
      .filter((linha) => linha.length > 0);

    linhas.push(...ordenadas);
    pagina.cleanup();
  }

  await documento.destroy();
  return linhas;
}

/** Mesma extracao, achatada em texto puro -- usada pelo parser em blocos. */
export async function extrairLinhas(caminhoPdf) {
  const linhas = await extrairFragmentos(caminhoPdf);
  return linhas.map((fragmentos) => fragmentos.map((f) => f.texto).join(' ').trim());
}

/**
 * Junta os pedacos vizinhos de uma mesma linha. Pedacos colados (distancia
 * pequena) viram um texto so -- e o que remonta palavras que o PDF quebrou no
 * meio. Um vao grande significa outra coluna, entao o pedaco fica separado.
 */
function agrupar(fragmentos) {
  const ordenados = fragmentos.sort((a, b) => a.x - b.x);
  const grupos = [];
  let atual = null;
  let fimAnterior = null;

  for (const fragmento of ordenados) {
    const vao = fimAnterior === null ? Infinity : fragmento.x - fimAnterior;

    if (atual && vao <= 10) {
      const precisaEspaco = vao > 1.2 && !/\s$/.test(atual.texto) && !/^\s/.test(fragmento.texto);
      atual.texto += (precisaEspaco ? ' ' : '') + fragmento.texto;
    } else {
      atual = { x: fragmento.x, texto: fragmento.texto };
      grupos.push(atual);
    }
    fimAnterior = fragmento.x + fragmento.largura;
  }

  return grupos
    .map((g) => ({ x: g.x, texto: g.texto.replace(/\s+/g, ' ').trim() }))
    .filter((g) => g.texto);
}
