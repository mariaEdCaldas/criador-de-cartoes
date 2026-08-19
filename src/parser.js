import { extrairLinhas } from './pdf.js';
import { extrairTelefones } from './telefone.js';
import { inferirGenero } from './genero.js';

const REGEX_DIA = /^Dia:\s*(\d{1,2})/i;
const REGEX_COORDENADOR = /Coordenador:\s*(.+)$/i;
const REGEX_MARCADOR = /\*([^*]{2,90})\*/g;
const REGEX_DATA = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/;

const MESES = [
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function limparNome(bruto) {
  return bruto
    .replace(/[❤\u{1F49B}\u{1F499}\u{1F49A}\u{1F49C}\u{1F496}\u{1F389}️]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * O registro corrente ja tem data de nascimento (ultimo campo da ficha) e a
 * linha nova nao tem numero nenhum: e um nome avulso, nao continuacao do
 * endereco.
 */
function ehNomeSolto(resto, atual) {
  const texto = resto.trim();
  if (!texto || /\d/.test(texto)) return false;
  if (!REGEX_DATA.test(atual.bruto)) return false;
  const palavras = texto.split(/\s+/);
  return palavras.length <= 4 && /^[\p{L}\p{M}.\s]{3,50}$/u.test(texto) && !ehCabecalho(texto);
}

function ehCabecalho(nome) {
  return /^anivers[aá]riantes/i.test(nome) || /^dia:/i.test(nome) || /^coordenador/i.test(nome);
}

function tituloDeNome(nome) {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return nome
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) =>
      i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1),
    )
    .join(' ');
}

/**
 * Percorre as linhas mantendo o dia e o coordenador correntes. Cada "*Nome*"
 * abre um registro; o texto que vem depois (endereco, telefone, data) pertence
 * a ele ate o proximo marcador.
 */
export function analisarLinhas(linhas, opcoes = {}) {
  const { dddPadrao = '67', paisPadrao = '55' } = opcoes;
  const registros = [];
  const avisos = [];

  let diaAtual = null;
  let coordenadorAtual = null;
  let atual = null;

  const fechar = () => {
    if (atual) registros.push(atual);
    atual = null;
  };

  for (const linha of linhas) {
    const dia = REGEX_DIA.exec(linha);
    if (dia) {
      fechar();
      diaAtual = Number(dia[1]);
      coordenadorAtual = null;
      continue;
    }

    const coordenador = REGEX_COORDENADOR.exec(linha);
    if (coordenador) {
      fechar();
      const nome = limparNome(coordenador[1]);
      coordenadorAtual = /^sem coordenador$/i.test(nome) ? null : nome;
      continue;
    }

    REGEX_MARCADOR.lastIndex = 0;
    let posicao = 0;
    let achado;
    let encontrouMarcador = false;

    while ((achado = REGEX_MARCADOR.exec(linha)) !== null) {
      encontrouMarcador = true;
      if (atual) atual.bruto += ' ' + linha.slice(posicao, achado.index);
      posicao = achado.index + achado[0].length;

      const nome = limparNome(achado[1]);
      if (ehCabecalho(nome)) {
        fechar();
        continue;
      }
      fechar();
      atual = {
        nome: tituloDeNome(nome),
        coordenador: coordenadorAtual,
        diaSecao: diaAtual,
        bruto: '',
      };
    }

    const resto = linha.slice(posicao);
    if (atual && !encontrouMarcador && ehNomeSolto(resto, atual)) {
      // Linha so com nome depois de um registro ja completo: e outra pessoa,
      // listada sem endereco/telefone.
      const solto = limparNome(resto);
      fechar();
      registros.push({
        nome: tituloDeNome(solto),
        coordenador: coordenadorAtual,
        diaSecao: diaAtual,
        bruto: '',
      });
    } else if (atual) {
      atual.bruto += ' ' + resto;
    } else if (!encontrouMarcador && resto.trim() && !/^[\s\p{Emoji}]*$/u.test(resto)) {
      // Nomes soltos no fim de um bloco ("Carmen", "Dr. Diego"): sem telefone.
      const solto = limparNome(resto);
      if (solto && !ehCabecalho(solto) && /^[\p{L}.\s]{2,60}$/u.test(solto)) {
        registros.push({
          nome: tituloDeNome(solto),
          coordenador: coordenadorAtual,
          diaSecao: diaAtual,
          bruto: '',
        });
      }
    }
  }
  fechar();

  const finalizados = registros.map((registro) => {
    const texto = registro.bruto.replace(/\s+/g, ' ').trim();
    const telefones = extrairTelefones(texto, dddPadrao, paisPadrao);
    const data = REGEX_DATA.exec(texto);

    let dia = registro.diaSecao;
    let mes = null;
    let ano = null;
    if (data) {
      dia = Number(data[1]);
      mes = Number(data[2]);
      ano = Number(data[3]);
    }

    const genero = inferirGenero(registro.nome);
    const problemas = [];
    if (telefones.length === 0) problemas.push('sem telefone');
    if (!data) problemas.push('sem data de nascimento no texto');
    if (ano && (ano < 1900 || ano > new Date().getFullYear())) problemas.push(`ano suspeito (${ano})`);
    if (dia && (dia < 1 || dia > 31)) problemas.push(`dia invalido (${dia})`);
    for (const t of telefones) problemas.push(...t.avisos.map((a) => `${t.formatado}: ${a}`));
    if (genero.confianca !== 'alta') problemas.push(`genero incerto (${genero.origem})`);

    return {
      id: null,
      nome: registro.nome,
      coordenador: registro.coordenador,
      dia,
      mes,
      ano,
      genero: genero.genero,
      generoOrigem: genero.origem,
      generoConfianca: genero.confianca,
      telefone: telefones[0]?.e164 ?? null,
      telefones: telefones.map((t) => t.e164),
      endereco: texto
        .replace(REGEX_DATA, '')
        .replace(/(?:\(\d{2}\)\s*)?\d{4,5}\s*-\s*\d{4},?/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
      problemas,
      ativo: telefones.length > 0,
    };
  });

  // Remove duplicatas exatas (o PDF repete alguns registros).
  const vistos = new Set();
  const unicos = [];
  for (const registro of finalizados) {
    const chave = `${registro.nome}|${registro.telefone ?? ''}|${registro.dia}/${registro.mes}`;
    if (vistos.has(chave)) {
      avisos.push(`duplicado ignorado: ${registro.nome}`);
      continue;
    }
    vistos.add(chave);
    registro.id = `${registro.dia}-${registro.nome}-${registro.telefone ?? 'sem-tel'}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9-]+/g, '-');
    unicos.push(registro);
  }

  return { registros: unicos, avisos };
}

export async function importarPdf(caminhoPdf, opcoes = {}) {
  const linhas = await extrairLinhas(caminhoPdf);
  const resultado = analisarLinhas(linhas, opcoes);

  const meses = resultado.registros.map((r) => r.mes).filter(Boolean);
  const mesPredominante = meses.length
    ? Number([...meses].sort((a, b) =>
        meses.filter((m) => m === b).length - meses.filter((m) => m === a).length)[0])
    : null;

  return {
    ...resultado,
    mes: mesPredominante,
    mesNome: mesPredominante ? MESES[mesPredominante - 1] : null,
    arquivo: caminhoPdf,
    importadoEm: new Date().toISOString(),
  };
}
