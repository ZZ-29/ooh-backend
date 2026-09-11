// Relogio do Ooh! e Ooh! Saude
// Roda periodicamente (via GitHub Actions), verifica se algum lembrete
// ou dose de remedio venceu, e dispara a notificacao push pelo Firebase.

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function processarColecao(nomeColecao, tituloPadrao) {
  const agora = Date.now();

  // Busca so por 'enviado == false' (consulta simples, sem precisar
  // de indice composto). O filtro de horario e feito aqui no codigo.
  const snap = await db.collection(nomeColecao).where('enviado', '==', false).get();

  if (snap.empty) {
    console.log(`[${nomeColecao}] Nenhum lembrete pendente cadastrado.`);
    return;
  }

  const vencidos = snap.docs.filter((doc) => {
    const dados = doc.data();
    return typeof dados.dt === 'number' && dados.dt <= agora;
  });

  if (vencidos.length === 0) {
    console.log(`[${nomeColecao}] ${snap.size} pendente(s), nenhum venceu ainda.`);
    return;
  }

  console.log(`[${nomeColecao}] ${vencidos.length} lembrete(s) vencido(s), enviando...`);

  for (const doc of vencidos) {
    const dados = doc.data();

    if (!dados.token) {
      console.log(`  - ${doc.id}: sem token salvo, marcando como enviado sem notificar.`);
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
      console.log(`  - ${doc.id}: notificacao enviada.`);
    } catch (err) {
      console.error(`  - ${doc.id}: erro ao enviar ->`, err.message);
    }

    await doc.ref.update({ enviado: true });
  }
}

async function main() {
  await processarColecao('lembretes', 'Ooh! Lembrete');
  await processarColecao('remedios', 'Ooh! Saude - Remedio');
  console.log('Verificacao concluida.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Erro geral no script:', err);
    process.exit(1);
  });
