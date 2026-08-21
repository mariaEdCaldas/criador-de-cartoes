import fs from 'node:fs';
import path from 'node:path';
import { CAMINHOS, lerConfig } from './config.js';
import { inferirGenero } from './genero.js';

function lerJson(caminho, padrao) {
  if (!fs.existsSync(caminho)) return padrao;
  try {
    return JSON.parse(fs.readFileSync(caminho, 'utf8'));
  } catch {
    return padrao;
  }
}

function salvarJson(caminho, dados) {
  fs.writeFileSync(caminho, JSON.stringify(dados, null, 2) + '\n');
}

const BASE_VAZIA = { mes: null, mesNome: null, arquivo: null, importadoEm: null, pessoas: [] };

export function lerBase() {
  return lerJson(CAMINHOS.aniversariantes, BASE_VAZIA);
}

export function salvarBase(base) {
  salvarJson(CAMINHOS.aniversariantes, base);
  return base;
}

/**
 * Substitui a base pelo mes recem importado, preservando as correcoes manuais
 * (genero, telefone, ativo) de quem ja existia com o mesmo nome.
 */
export function importarParaBase(resultado) {
  const anterior = lerBase();
  const correcoes = new Map(
    anterior.pessoas.map((p) => [chaveDePessoa(p), p]),
  );

  const pessoas = resultado.registros.map((registro) => {
    const antiga = correcoes.get(chaveDePessoa(registro));
    if (!antiga) return { ...registro, editado: false };
    return {
      ...registro,
      genero: antiga.editado ? antiga.genero : registro.genero,
      telefone: antiga.editado && antiga.telefone ? antiga.telefone : registro.telefone,
      ativo: antiga.editado ? antiga.ativo : registro.ativo,
      editado: antiga.editado ?? false,
    };
  });

  // Quem foi cadastrado a mao nao vem no PDF: precisa sobreviver a importacao.
  const chavesDoPdf = new Set(pessoas.map(chaveDePessoa));
  const manuais = anterior.pessoas.filter(
    (p) => p.origem === 'manual' && !chavesDoPdf.has(chaveDePessoa(p)),
  );

  if (fs.existsSync(CAMINHOS.aniversariantes)) {
    const backup = path.join(
      CAMINHOS.dados,
      `aniversariantes-${new Date().toISOString().slice(0, 10)}-${Date.now()}.bak.json`,
    );
    fs.copyFileSync(CAMINHOS.aniversariantes, backup);
  }

  return salvarBase({
    mes: resultado.mes,
    mesNome: resultado.mesNome,
    arquivo: resultado.arquivo,
    importadoEm: resultado.importadoEm,
    avisos: resultado.avisos,
    pessoas: ordenar([...pessoas, ...manuais]),
  });
}

function chaveDePessoa(pessoa) {
  return `${(pessoa.nome ?? '').toLowerCase()}|${pessoa.dia}`;
}


function ordenar(pessoas) {
  return pessoas.sort((a, b) => a.dia - b.dia || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * Aceita o telefone como a pessoa digitou -- "(67) 99999-8888", "67999998888",
 * "5567999998888" -- e devolve sempre no formato usado no envio.
 */
export function normalizarTelefone(bruto) {
  const digitos = String(bruto ?? '').replace(/\D/g, '');
  if (!digitos) return null;
  const { paisPadrao, dddPadrao } = lerConfig().envio;
  if (digitos.length >= 12 && digitos.startsWith(paisPadrao)) return digitos;
  if (digitos.length === 10 || digitos.length === 11) return paisPadrao + digitos;
  if (digitos.length === 8 || digitos.length === 9) return paisPadrao + dddPadrao + digitos;
  return digitos;
}

function gerarId(nome, dia, telefone) {
  return `${dia}-${nome}-${telefone ?? 'sem-tel'}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9-]+/g, '-');
}

export function adicionarPessoa(dados) {
  const base = lerBase();
  const nome = String(dados.nome ?? '').trim();
  const dia = Number(dados.dia);
  if (!nome) throw new Error('Informe o nome.');
  if (!dia || dia < 1 || dia > 31) throw new Error('Informe um dia entre 1 e 31.');

  const telefone = normalizarTelefone(dados.telefone);
  const genero = dados.genero && dados.genero !== 'auto'
    ? dados.genero
    : inferirGenero(nome).genero;

  let id = gerarId(nome, dia, telefone);
  if (base.pessoas.some((p) => p.id === id)) id += '-' + Date.now().toString(36);

  const pessoa = {
    id,
    nome,
    coordenador: String(dados.coordenador ?? '').trim() || null,
    dia,
    mes: base.mes ?? new Date().getMonth() + 1,
    ano: dados.ano ? Number(dados.ano) : null,
    genero,
    generoOrigem: 'manual',
    generoConfianca: 'alta',
    telefone,
    telefones: telefone ? [telefone] : [],
    endereco: String(dados.endereco ?? '').trim(),
    problemas: telefone ? [] : ['sem telefone'],
    ativo: Boolean(telefone),
    editado: true,
    origem: 'manual',
  };

  base.pessoas = ordenar([...base.pessoas, pessoa]);
  salvarBase(base);
  return pessoa;
}

/** So apaga cadastro manual: o que veio do PDF volta na proxima importacao. */
export function removerPessoa(id) {
  const base = lerBase();
  const pessoa = base.pessoas.find((p) => p.id === id);
  if (!pessoa) throw new Error('Pessoa nao encontrada.');
  if (pessoa.origem !== 'manual') {
    throw new Error('Só dá para excluir quem foi cadastrado à mão. Para não enviar a alguém do PDF, desmarque "Ativo".');
  }
  base.pessoas = base.pessoas.filter((p) => p.id !== id);
  salvarBase(base);
  return pessoa;
}

export function aniversariantesDoDia(dia, mes) {
  const base = lerBase();
  const hoje = new Date();
  const diaAlvo = dia ?? hoje.getDate();
  const mesAlvo = mes ?? hoje.getMonth() + 1;
  return base.pessoas.filter(
    (p) => p.dia === diaAlvo && (p.mes == null || p.mes === mesAlvo),
  );
}

export function lerEnviados() {
  return lerJson(CAMINHOS.enviados, []);
}

export function registrarEnvio(entrada) {
  const enviados = lerEnviados();
  enviados.push({ ...entrada, quando: new Date().toISOString() });
  salvarJson(CAMINHOS.enviados, enviados);
  return entrada;
}

/** AAAA-MM-DD no fuso local (toISOString jogaria para UTC e poderia virar o dia). */
export function dataLocalIso(data = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`;
}

/** Evita mandar o mesmo cartao duas vezes no mesmo dia. */
export function jaEnviouHoje(pessoa, data = new Date()) {
  const dia = dataLocalIso(data);
  return lerEnviados().some(
    (e) => e.status === 'enviado' && e.data === dia && e.telefone === pessoa.telefone,
  );
}
