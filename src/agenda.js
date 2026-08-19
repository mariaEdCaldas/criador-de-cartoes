import cron from 'node-cron';
import { lerConfig } from './config.js';
import { enviarDoDia } from './envio.js';
import { whatsapp } from './whatsapp.js';

let tarefa = null;

/**
 * Agenda o disparo diario no horario do config. So roda de fato quando
 * `envio.automatico` esta ligado e o WhatsApp esta conectado.
 */
export function iniciarAgenda(aoRegistrar = console.log) {
  pararAgenda();
  const config = lerConfig();
  const [hora, minuto] = config.envio.horario.split(':').map(Number);
  const expressao = `${minuto || 0} ${hora || 8} * * *`;

  tarefa = cron.schedule(
    expressao,
    async () => {
      if (!lerConfig().envio.automatico) {
        aoRegistrar('[agenda] envio automatico desligado, nada a fazer.');
        return;
      }
      if (whatsapp.estado !== 'conectado') {
        aoRegistrar('[agenda] WhatsApp desconectado; envio de hoje NAO foi feito.');
        return;
      }
      aoRegistrar(`[agenda] disparando envios de ${new Date().toLocaleDateString('pt-BR')}`);
      try {
        const resultado = await enviarDoDia({});
        const ok = resultado.itens.filter((i) => i.status === 'enviado').length;
        aoRegistrar(`[agenda] concluido: ${ok}/${resultado.total} enviados.`);
      } catch (erro) {
        aoRegistrar(`[agenda] erro: ${erro.message}`);
      }
    },
    { timezone: config.envio.fusoHorario },
  );

  aoRegistrar(
    `[agenda] agendado para ${config.envio.horario} (${config.envio.fusoHorario}) — automatico: ${
      config.envio.automatico ? 'sim' : 'nao'
    }`,
  );
  return tarefa;
}

export function pararAgenda() {
  if (tarefa) {
    tarefa.stop();
    tarefa = null;
  }
}
