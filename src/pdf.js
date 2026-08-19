import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * Extrai o texto do PDF reconstruindo as linhas pela posicao vertical de cada
 * fragmento. O PDF gerado pelo Word espalha nome, endereco e telefone em
 * colunas; agrupar por linha deixa cada registro legivel para o parser.
 */
export async function extrairLinhas(caminhoPdf) {
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
      if (!item.str) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      // Arredonda o Y para juntar fragmentos da mesma linha visual.
      const chave = Math.round(y / 3);
      if (!porLinha.has(chave)) porLinha.set(chave, []);
      porLinha.get(chave).push({ x, texto: item.str, largura: item.width ?? 0 });
    }

    const ordenadas = [...porLinha.entries()]
      .sort((a, b) => b[0] - a[0]) // do topo para o rodape
      .map(([, fragmentos]) => juntarFragmentos(fragmentos))
      .filter(Boolean);

    linhas.push(...ordenadas);
    pagina.cleanup();
  }

  await documento.destroy();
  return linhas;
}

/**
 * Junta os fragmentos de uma linha usando a distancia horizontal entre eles.
 * Sem isso, palavras que o PDF quebrou em dois pedacos ("Ro" + "drigues")
 * virariam duas palavras separadas.
 */
function juntarFragmentos(fragmentos) {
  const ordenados = fragmentos.sort((a, b) => a.x - b.x);
  let saida = '';
  let fimAnterior = null;

  for (const fragmento of ordenados) {
    if (!fragmento.texto) continue;
    if (fimAnterior !== null) {
      const espaco = fragmento.x - fimAnterior;
      const jaTemEspaco = /\s$/.test(saida) || /^\s/.test(fragmento.texto);
      if (!jaTemEspaco && espaco > 1.2) saida += ' ';
    }
    saida += fragmento.texto;
    fimAnterior = fragmento.x + fragmento.largura;
  }

  return saida.replace(/\s+/g, ' ').trim();
}
