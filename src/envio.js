import { EventEmitter } from 'node:events';
import { lerConfig } from './config.js';
import { aniversariantesDoDia, dataLocalIso, jaEnviouHoje, registrarEnvio } from './db.js';
import { gerarCartao, textoDoCartao } from './cartao.js';
import { primeiroNome } from './genero.js';
import { whatsapp } from './whatsapp.js';

/** Estado da rodada corrente, consultado pelo painel. */
export const eventos = new EventEmitter();

let rodada = { rodando: false, total: 0, feitos: 0, itens: [], iniciadaEm: null, simulacao: false };

export function estadoDaRodada() {
  return rodada;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function intervaloAleatorio(config) {
  const { intervaloMinimoSegundos: min, intervaloMaximoSegundos: max } = config.envio;
  return (min + Math.random() * Math.max(0, max - min)) * 1000;
}

export function filaDoDia(data = new Date()) {
  const pessoas = aniversariantesDoDia(data.getDate(), data.getMonth() + 1);
  return pessoas.map((pessoa) => {
    const motivos = [];
    if (!pessoa.ativo) motivos.push('desativado no painel');
    if (!pessoa.telefone) motivos.push('sem telefone');
    if (jaEnviouHoje(pessoa, data)) motivos.push('ja enviado hoje');
    return { pessoa, enviavel: motivos.length === 0, motivos };
  });
}

/**
 * Gera e envia os cartoes de um dia. Com `simulacao` gera as imagens e monta o
 * relatorio sem tocar no WhatsApp -- util para conferir antes de disparar.
 */
export async function enviarDoDia({ data = new Date(), simulacao = false, ids = null } = {}) {
  if (rodada.rodando) throw new Error('Ja existe um envio em andamento.');

  const config = lerConfig();
  let fila = filaDoDia(data).filter((item) => item.enviavel);
  if (ids) fila = fila.filter((item) => ids.includes(item.pessoa.id));

  const limite = config.envio.limiteDiario;
  if (fila.length > limite) {
    fila = fila.slice(0, limite);
  }

  rodada = {
    rodando: true,
    simulacao,
    total: fila.length,
    feitos: 0,
    itens: [],
    iniciadaEm: new Date().toISOString(),
  };
  eventos.emit('atualizou', rodada);

  const dataIso = dataLocalIso(data);

  for (const [indice, item] of fila.entries()) {
    const { pessoa } = item;
    const registro = { id: pessoa.id, nome: pessoa.nome, telefone: pessoa.telefone, data: dataIso };

    try {
      const cartao = await gerarCartao(pessoa, config);
      registro.cartao = cartao.arquivo;
      registro.texto = cartao.texto;

      if (simulacao) {
        registro.status = 'simulado';
      } else {
        const legenda = config.mensagem.enviarLegenda
          ? config.mensagem.legenda
              .replace('{nome}', primeiroNome(pessoa.nome))
              .replace('{nomeCompleto}', pessoa.nome)
          : undefined;
        registro.destino = await whatsapp.enviarImagem(pessoa.telefone, cartao.buffer, legenda);
        registro.status = 'enviado';
      }
    } catch (erro) {
      registro.status = 'erro';
      registro.erro = erro.message;
    }

    if (!simulacao) registrarEnvio(registro);
    rodada.itens.push(registro);
    rodada.feitos = indice + 1;
    eventos.emit('atualizou', rodada);

    const ultimo = indice === fila.length - 1;
    if (!simulacao && !ultimo) {
      // Pausa irregular entre mensagens: envio em rajada e o que faz o
      // WhatsApp marcar a conta como spam.
      await dormir(intervaloAleatorio(config));
    }
  }

  rodada.rodando = false;
  eventos.emit('atualizou', rodada);
  return rodada;
}

export function previaDoDia(data = new Date()) {
  const config = lerConfig();
  return filaDoDia(data).map((item) => ({
    ...item,
    textoCartao: textoDoCartao(item.pessoa, config),
  }));
}
