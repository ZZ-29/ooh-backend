// Funcao do Vercel - versao da "porta" que o cron-job.org vai bater
// Faz a mesma coisa que o check-reminders.js do GitHub Actions,
// mas agora e chamada por um servico externo mais confiavel para horarios.
//
// ATUALIZADO: agora com logs detalhados em cada etapa, e so marca
// "enviado: true" quando o envio realmente funciona (antes marcava
// sempre, mesmo em caso de erro, o que escondia falhas para sempre).

const admin = require('firebase-admin');

let appInicializado = false;

function iniciarFirebase() {
  if (appInicializado) return;
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  appInicializado = true;
}

async function processarColecao(db, nomeColecao, tituloPadrao) {
  const agora = Date.now();
  const snap = await db.collection(nomeColecao).where('enviado', '==', false).get();

  console.log(`[${nomeColecao}] pendentes na consulta: ${snap.size}`);

  if (snap.empty) {
    return { colecao: nomeColecao, pendentes: 0, enviados: 0 };
  }

  const vencidos = snap.docs.filter((doc) => {
    const dados = doc.data();
    const ok = typeof dados.dt === 'number' && dados.dt <= agora;
    console.log(`[${nomeColecao}] doc ${doc.id}: dt=${dados.dt} (tipo ${typeof dados.dt}) agora=${agora} vencido=${ok}`);
    return ok;
  });

  console.log(`[${nomeColecao}] vencidos para processar agora: ${vencidos.length}`);

  let enviados = 0;

  for (const doc of vencidos) {
    const dados = doc.data();

    if (!dados.token) {
      console.log(`[${nomeColecao}] doc ${doc.id} sem token, marcando como enviado (nao ha como notificar).`);
      await doc.ref.update({ enviado: true });
      continue;
    }

    try {
      const resposta = await admin.messaging().send({
        token: dados.token,
        data: {
          title: tituloPadrao,
          body: String(dados.txt || '')
        }
      });
      console.log(`[${nomeColecao}] doc ${doc.id} ENVIADO com sucesso. Resposta FCM:`, resposta);
      enviados++;
      // So marca como enviado quando o FCM realmente aceitou a mensagem
      await doc.ref.update({ enviado: true });
    } catch (err) {
      console.error(`[${nomeColecao}] doc ${doc.id} FALHOU ao enviar. Codigo: ${err.code} | Mensagem: ${err.message}`);
      // NAO marca enviado:true aqui -> vai tentar de novo no proximo ciclo do cron
    }
  }

  return { colecao: nomeColecao, pendentes: snap.size, enviados };
}

module.exports = async function handler(req, res) {
  // Protecao simples: so roda se a chave secreta bater
  const chaveEsperada = process.env.CRON_SECRET;
  const chaveRecebida = req.query.key;

  if (chaveEsperada && chaveRecebida !== chaveEsperada) {
    res.status(401).json({ erro: 'Chave invalida' });
    return;
  }

  try {
    iniciarFirebase();
    const db = admin.firestore();

    const resultadoLembretes = await processarColecao(db, 'lembretes', 'Ooh! Lembrete');
    const resultadoRemedios = await processarColecao(db, 'remedios', 'Ooh! Saude - Remedio');

    res.status(200).json({
      ok: true,
      horario: new Date().toISOString(),
      resultados: [resultadoLembretes, resultadoRemedios]
    });
  } catch (err) {
    console.error('Erro geral:', err);
    res.status(500).json({ ok: false, erro: err.message });
  }
};
