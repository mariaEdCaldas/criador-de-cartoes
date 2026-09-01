import { extrairTelefones } from './telefone.js';
import { inferirGenero } from './genero.js';

/**
 * Parser da planilha em formato de tabela:
 *
 *   Dia | Coordenador | Nome | Telefone | Data de nascimento
 *   1   | ADMILSON    | Maria Lina De Jesus Moura | (67) 99289-7116 | 01/09/1970
 *
 * Celulas longas quebram em mais de uma linha visual; a linha seguinte nao tem
 * data e e emendada na coluna certa pela posicao horizontal.
 */

const REGEX_DATA = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
const REGEX_DIA_COORDENADOR = /^(\d{1,2})\s+(.+)$/;
const TEM_TELEFONE = /\d{4,5}\s*-\s*\d{4}/;
const REGEX_CABECALHO = /^Dia\s+Coordenador\s+Nome\s+Telefone/i;
const REGEX_FALECEU = /\(?\s*(faleceu|falecid[ao])\s*\)?/i;
const REGEX_DICA_GENERO = /\((F|M)\)\s*$/i;

export function ehFormatoTabela(linhasDeTexto) {
  return linhasDeTexto.slice(0, 20).some((linha) => REGEX_CABECALHO.test(linha));
}

function mediana(valores) {
  if (!valores.length) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.floor(ordenados.length / 2)];
}

export function analisarTabela(linhasDeFragmentos, opcoes = {}) {
  const { dddPadrao = '67', paisPadrao = '55' } = opcoes;
  const brutos = [];
  const avisos = [];
  const xDeNome = [];
  const xDeTelefone = [];
  let atual = null;

  for (const fragmentos of linhasDeFragmentos) {
    if (!fragmentos.length) continue;
    const linhaInteira = fragmentos.map((f) => f.texto).join(' ');
    if (REGEX_CABECALHO.test(linhaInteira)) continue; // cabecalho repetido a cada pagina

    const indiceData = fragmentos.findIndex((f) => REGEX_DATA.test(f.texto));

    if (indiceData === -1) {
      // Linha sem data: e a continuacao da celula da linha anterior.
      if (!atual) continue;
      const ancoraNome = mediana(xDeNome);
      const ancoraTelefone = mediana(xDeTelefone);
      for (const fragmento of fragmentos) {
        const ehTelefone = TEM_TELEFONE.test(fragmento.texto) || (
          ancoraNome !== null && ancoraTelefone !== null &&
          Math.abs(fragmento.x - ancoraTelefone) < Math.abs(fragmento.x - ancoraNome)
        );
        if (ehTelefone) atual.telefone += ' ' + fragmento.texto;
        else atual.nome += ' ' + fragmento.texto;
      }
      continue;
    }

    // Linha completa: comeca um registro novo.
    const data = REGEX_DATA.exec(fragmentos[indiceData].texto);
    const registro = { dia: null, coordenador: null, nome: '', telefone: '', data };

    for (const [indice, fragmento] of fragmentos.entries()) {
      if (indice === indiceData) continue;
      const texto = fragmento.texto.trim();

      if (registro.dia === null && !TEM_TELEFONE.test(texto)) {
        if (/^\d{1,2}$/.test(texto)) {
          registro.dia = Number(texto);
          continue;
        }
        const casou = REGEX_DIA_COORDENADOR.exec(texto);
        if (casou) {
          registro.dia = Number(casou[1]);
          registro.coordenador = casou[2].trim();
          continue;
        }
      }
      // Coordenador que veio num pedaco proprio, logo depois do dia solto.
      if (registro.dia !== null && registro.coordenador === null && !registro.nome
        && !TEM_TELEFONE.test(texto) && texto === texto.toUpperCase() && texto.length < 25) {
        registro.coordenador = texto;
        continue;
      }

      if (TEM_TELEFONE.test(texto)) {
        registro.telefone += (registro.telefone ? ' ' : '') + texto;
        xDeTelefone.push(fragmento.x);
      } else {
        registro.nome += (registro.nome ? ' ' : '') + texto;
        xDeNome.push(fragmento.x);
      }
    }

    if (!registro.nome) continue;
    brutos.push(registro);
    atual = registro;
  }

  const finalizados = brutos.map((bruto) => montar(bruto, dddPadrao, paisPadrao));

  // Remove repetidos: a planilha traz a mesma pessoa mais de uma vez.
  const vistos = new Set();
  const unicos = [];
  for (const registro of finalizados) {
    const chave = `${registro.nome.toLowerCase()}|${registro.telefone ?? ''}|${registro.dia}`;
    if (vistos.has(chave)) {
      avisos.push(`duplicado ignorado: ${registro.nome}`);
      continue;
    }
    vistos.add(chave);
    unicos.push(registro);
  }

  return { registros: unicos, avisos };
}

function montar(bruto, dddPadrao, paisPadrao) {
  let nome = bruto.nome.replace(/\s+/g, ' ').trim();
  const problemas = [];

  // "(FALECEU)" na planilha: essa pessoa NAO pode receber cartao.
  const faleceu = REGEX_FALECEU.test(nome) || REGEX_FALECEU.test(bruto.coordenador ?? '');
  if (faleceu) {
    nome = nome.replace(REGEX_FALECEU, '').replace(/\s+/g, ' ').trim();
    problemas.push('marcado como falecido na planilha');
  }

  // "(F)" / "(M)" depois do nome e uma dica de genero da propria planilha.
  let generoDaPlanilha = null;
  const dica = REGEX_DICA_GENERO.exec(nome);
  if (dica) {
    generoDaPlanilha = dica[1].toUpperCase();
    nome = nome.replace(REGEX_DICA_GENERO, '').trim();
  }

  const telefones = extrairTelefones(bruto.telefone, dddPadrao, paisPadrao);
  const dia = Number(bruto.data[1]);
  const mes = Number(bruto.data[2]);
  const ano = Number(bruto.data[3]);

  const genero = generoDaPlanilha
    ? { genero: generoDaPlanilha, origem: 'planilha', confianca: 'alta' }
    : inferirGenero(nome);

  const coordenador = (bruto.coordenador ?? '')
    .replace(REGEX_FALECEU, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (telefones.length === 0) problemas.push('sem telefone');
  if (ano && (ano < 1900 || ano > new Date().getFullYear())) problemas.push(`ano suspeito (${ano})`);
  for (const t of telefones) problemas.push(...t.avisos.map((a) => `${t.formatado}: ${a}`));
  if (genero.confianca === 'baixa') problemas.push(`genero incerto (${genero.origem})`);

  return {
    id: `${dia}-${nome}-${telefones[0]?.e164 ?? 'sem-tel'}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9-]+/g, '-'),
    nome: tituloDeNome(nome),
    coordenador: /^sem coordenador$/i.test(coordenador) ? null : (coordenador || null),
    dia,
    mes,
    ano,
    genero: genero.genero,
    generoOrigem: genero.origem,
    generoConfianca: genero.confianca,
    telefone: telefones[0]?.e164 ?? null,
    telefones: telefones.map((t) => t.e164),
    endereco: '',
    problemas,
    // Falecido nunca entra na fila de envio, mesmo tendo telefone.
    ativo: telefones.length > 0 && !faleceu,
    falecido: faleceu,
  };
}

function tituloDeNome(nome) {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return nome
    .toLowerCase()
    .split(/\s+/)
    .map((parte, i) => (i > 0 && minusculas.has(parte)
      ? parte
      : parte.charAt(0).toUpperCase() + parte.slice(1)))
    .join(' ');
}
