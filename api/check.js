// Funcao do Vercel - versao da "porta" que o cron-job.org vai bater
// Faz a mesma coisa que o check-reminders.js do GitHub Actions,
// mas agora e chamada por um servico externo mais confiavel para horarios.

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

  if (snap.empty) {
    return { colecao: nomeColecao, pendentes: 0, enviados: 0 };
  }

  const vencidos = snap.docs.filter((doc) => {
    const dados = doc.data();
    return typeof dados.dt === 'number' && dados.dt <= agora;
  });

  let enviados = 0;

  for (const doc of vencidos) {
    const dados = doc.data();

    if (!dados.token) {
      await doc.ref.update({ enviado: true });
      continue;
    }

    try {
      await admin.messaging().send({
        token: dados.token,
        data: {
          title: tituloPadrao,
          body: String(dados.txt || '')
        }
      });
      enviados++;
    } catch (err) {
      console.error(`Erro ao enviar ${doc.id}:`, err.message);
    }

    await doc.ref.update({ enviado: true });
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
