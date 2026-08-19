import fs from 'node:fs';
import path from 'node:path';
import { CAMINHOS } from './config.js';

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
    pessoas,
  });
}

function chaveDePessoa(pessoa) {
  return `${(pessoa.nome ?? '').toLowerCase()}|${pessoa.dia}`;
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
