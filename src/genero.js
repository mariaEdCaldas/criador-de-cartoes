import fs from 'node:fs';
import { CAMINHOS } from './config.js';

/**
 * Descobre se o tratamento do cartao deve ser "Amigo" ou "Amiga".
 * Ordem: correcao manual salva > dicionario > regra de terminacao.
 * Nada aqui e infalivel; o painel permite corrigir e a correcao vira
 * dicionario permanente para os proximos meses.
 */

const FEMININOS = new Set(`
ana adriana adelinda adivarina agostinha alexandra aline amanda andrea andreia angela
antonia aparecida arilda ariane augusta beatriz benedita benicia bianca brena bruna
carla carmen carmem cassia catarina celia celma cida cilene cinthia cinthya clarice
claudete claudia claudenice claudineia cleusa creuza cristiane cristina daiane daniele
darci darlene dayane diene doraci dorailda edna eduarda elaine elena eliana eliane
elisa eliza elizana elza erica erli ester eunice eva evelin evellyn fabiana fernanda
francielle geisiane geovanna geralda geraldina gisele gislaine gloria graciela graziela
greice hilma iara ilda ines iraci irene isabel iva ivaneide ivete izabel janaina
jaqueline jessica joana jociane josely jovelina juliana julia jucimara katia keila
keli kimberly lais laura leidiana leni leticia lidia lislei lorena lorenir luana
lucia luciana lucilena lucila lucineia luzia luzimar luzinete maiara marcela marcia
maria mariana marilene marilza marina marines marisa marisela marlene marta mayara
mayra meire meyre milena mirella mirian nadielle naudimar neide neli nerci neuza
nilva nilza nilvana noemi noemir ordalia paula poliana priscila raika regiane regina
renata rita roberta robertina rosa rosana rose roselene rosemary rosilene rosineide
sandra sebastiana selma severina sheyla simone simony sonia suely susana suzana tania
tatiana tatiani teresa terezinha thais thays thaynara valdirene valquiria vanessa
vania vanuza vera vivian viviane wanessa wanir yolanda zeide zelia zenaide zenith
zilda zeldite edelinia edilenia celiam agnes amelia arissa cacilda carmen elusia
feliciana gilva jhoilly joareis kailaine kamilla lauren leidiana lorena lucia
maryoris mikaela nesynta reni rosemeire sidneia valdirene vandira wanderleia
`.trim().split(/\s+/));

const MASCULINOS = new Set(`
adair adelcio adilson admilson adivar agnaldo aladir alexandre almir amando anderson
andre antonio aparecido aroldo arilei benedito breno bruno carlos celso claudio
cristiano dair daniel darci david diego dorival edmar eduardo elias enir erik
evandro fabio felipe fernando francis gabriel gelson genildo geovani geraldo gilmar
gilberto guilherme heitor herik ituriel jailson jean joao joaquim joao-pedro joel jorge
jose josmail juliano julio kaua leandro leonardo leonildo lorhan lucas luciano luis
luiz manoel marcelo marcio marco marcos mario mauricio mauro miguel milton nelson
nesynson nilson nilton nicolas osvaldo paulo pedro rafael raimundo reginaldo renato
ricardo roberto rodrigo rogerio ronaldo salvador samuel sandro sebastiao sergio
sidnei silvio thiago tyson vagner valdicio valdir vander vanderlei victor vicente
vitor wagner walter wanderley washington wellington wesley willian zamarso ze
`.trim().split(/\s+/));

const TERMINACOES_FEMININAS = [
  'ana', 'ina', 'ilda', 'inda', 'iana', 'lene', 'lena', 'nete', 'ete', 'ice', 'iza',
  'isa', 'essa', 'ssa', 'nia', 'cia', 'sia', 'lia', 'ria', 'tia', 'ela', 'ila', 'ula',
  'eide', 'aide', 'ilde', 'aura', 'eusa', 'uza', 'osa',
];
const TERMINACOES_MASCULINAS = [
  'son', 'sson', 'ton', 'ilton', 'aldo', 'ardo', 'erto', 'inho', 'iel', 'uel', 'ael',
  'aro', 'eiro', 'ilo', 'ino', 'ando', 'endo', 'undo', 'or', 'ivo', 'esio', 'mar',
];

function normalizar(texto) {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function primeiroNome(nomeCompleto) {
  const partes = (nomeCompleto ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '';
  // "Dr. Diego" / "Sr. Joao": ignora o pronome de tratamento.
  const ignorar = new Set(['dr.', 'dra.', 'sr.', 'sra.', 'pastor', 'pr.']);
  const primeiro = ignorar.has(partes[0].toLowerCase()) && partes[1] ? partes[1] : partes[0];
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase();
}

function lerManuais() {
  if (!fs.existsSync(CAMINHOS.generoManual)) return {};
  try {
    return JSON.parse(fs.readFileSync(CAMINHOS.generoManual, 'utf8'));
  } catch {
    return {};
  }
}

export function salvarGeneroManual(nome, genero) {
  const manuais = lerManuais();
  manuais[normalizar(primeiroNome(nome))] = genero;
  fs.writeFileSync(CAMINHOS.generoManual, JSON.stringify(manuais, null, 2) + '\n');
}

export function inferirGenero(nomeCompleto) {
  const nome = normalizar(primeiroNome(nomeCompleto));
  if (!nome) return { genero: 'F', confianca: 'baixa', origem: 'vazio' };

  const manuais = lerManuais();
  if (manuais[nome]) return { genero: manuais[nome], confianca: 'alta', origem: 'manual' };
  if (FEMININOS.has(nome)) return { genero: 'F', confianca: 'alta', origem: 'dicionario' };
  if (MASCULINOS.has(nome)) return { genero: 'M', confianca: 'alta', origem: 'dicionario' };

  for (const fim of TERMINACOES_MASCULINAS) {
    if (nome.endsWith(fim)) return { genero: 'M', confianca: 'media', origem: `terminacao -${fim}` };
  }
  for (const fim of TERMINACOES_FEMININAS) {
    if (nome.endsWith(fim)) return { genero: 'F', confianca: 'media', origem: `terminacao -${fim}` };
  }
  if (nome.endsWith('a')) return { genero: 'F', confianca: 'media', origem: 'terminacao -a' };
  if (nome.endsWith('o')) return { genero: 'M', confianca: 'media', origem: 'terminacao -o' };

  return { genero: 'F', confianca: 'baixa', origem: 'chute' };
}

export function tratamento(genero) {
  return genero === 'M' ? 'Amigo' : 'Amiga';
}
