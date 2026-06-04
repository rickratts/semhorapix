/**
 * Webhook de RECEBIMENTO PIX — SHVPIX
 * ------------------------------------
 * Réplica em backend (Vercel Serverless) do fluxo N8N "RECEBIMENTO PIX".
 *
 * Endpoint (após deploy): https://<seu-projeto>.vercel.app/api/pix
 * Configure essa URL no painel da Asaas (Webhooks → evento PAYMENT_RECEIVED).
 *
 * Fluxo replicado:
 *   1. Recebe POST da Asaas (evento de pagamento PIX).
 *   2. Busca o nome do cliente na API da Asaas (/v3/customers/{id}).
 *   3. Se o cliente for "Appmax Plataforma Vendas Ltda" → ignora (não registra).
 *   4. Formata valor (R$ BRL) e data/hora (pt-BR, +3h como no N8N).
 *   5. Insere na tabela `pix` do Supabase SEMHORAPIX (empresa_id=2, status=true).
 *   6. Envia mensagem no grupo de WhatsApp via uazapi.
 *   7. Se o envio falhar, espera 20s e tenta novamente uma vez.
 *
 * Variáveis de ambiente (configurar na Vercel):
 *   SUPABASE_URL                (default: projeto semhorapix)
 *   SUPABASE_SERVICE_ROLE_KEY   (obrigatória — service role, ignora RLS)
 *   ASAAS_ACCESS_TOKEN          (obrigatória — token da API Asaas)
 *   UAZAPI_URL                  (default: https://semhoravendas.uazapi.com)
 *   UAZAPI_TOKEN                (obrigatória)
 *   UAZAPI_GRUPO                (default: 120363407246179266)
 *   PIX_EMPRESA_ID              (default: 2)
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xhzeruahwekxszyxtxwy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ASAAS_TOKEN = process.env.ASAAS_ACCESS_TOKEN;
const UAZAPI_URL = process.env.UAZAPI_URL || 'https://semhoravendas.uazapi.com';
const UAZAPI_TOKEN = process.env.UAZAPI_TOKEN;
const UAZAPI_GRUPO = process.env.UAZAPI_GRUPO || '120363407246179266';
const EMPRESA_ID = Number(process.env.PIX_EMPRESA_ID || 2);

const CLIENTE_IGNORADO = 'Appmax Plataforma Vendas Ltda';

// Formata a data como no N8N: "DD/MM/AAAA às HH:MM:SS" (com +3h)
function formatarData(raw) {
  try {
    if (!raw) return '';
    const d = new Date(String(raw).replace(' ', 'T')); // "2026-06-04 10:47:58" → ISO
    d.setHours(d.getHours() + 3);
    const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return `${data} às ${hora}`;
  } catch {
    return '';
  }
}

// Busca o nome do cliente na Asaas (equivale ao nó "CLIENTE")
async function buscarNomeCliente(customerId) {
  if (!customerId || !ASAAS_TOKEN) return '';
  try {
    const r = await fetch(`https://api.asaas.com/v3/customers/${customerId}`, {
      headers: {
        accept: 'application/json',
        access_token: ASAAS_TOKEN,
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    });
    const cli = await r.json().catch(() => ({}));
    return cli?.name || '';
  } catch (e) {
    console.error('[pix] erro ao buscar cliente Asaas:', e.message);
    return ''; // continua mesmo com erro (como onError=continue no N8N)
  }
}

// Insere o registro na tabela `pix` (equivale ao nó "registra pix")
async function registrarPix({ valor, nome, dataPix }) {
  if (!SUPABASE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/pix`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      valor,
      empresa_id: EMPRESA_ID,
      nome,
      status: true,
      data_pix: dataPix,
    }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Supabase insert falhou (${r.status}): ${txt}`);
  }
}

// Envia mensagem no grupo via uazapi (equivale a "envio pix grupo")
async function enviarWhatsApp(texto) {
  const r = await fetch(`${UAZAPI_URL}/send/text`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      token: UAZAPI_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ number: UAZAPI_GRUPO, text: texto }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.error) {
    throw new Error(`uazapi falhou (${r.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, servico: 'shvpix-recebimento-pix', ts: Date.now() });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, erro: 'Método não permitido' });
  }

  try {
    const body = req.body ?? {};
    const payment = body.payment || {};

    // 1 + 2 — busca nome do cliente na Asaas
    const nome = await buscarNomeCliente(payment.customer);

    // 3 — ignora cliente Appmax
    if (nome === CLIENTE_IGNORADO) {
      console.log('[pix] cliente ignorado:', nome);
      return res.status(200).json({ ok: true, ignorado: true });
    }

    // 4 — formata dados
    const valorFmt = Number(payment.value).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
    const dataPix = formatarData(body.dateCreated);

    // 5 — registra no Supabase semhorapix
    await registrarPix({ valor: payment.value, nome, dataPix });

    // 6 + 7 — envia no WhatsApp com 1 retry após 20s
    const texto = `PIX CONFIRMADO✅✅ ${nome}  valor: ${valorFmt}  Às ${dataPix}`;
    try {
      await enviarWhatsApp(texto);
    } catch (e1) {
      console.error('[pix] envio falhou, tentando novamente em 20s:', e1.message);
      await sleep(20_000);
      try {
        await enviarWhatsApp(texto);
      } catch (e2) {
        console.error('[pix] envio falhou na 2ª tentativa:', e2.message);
        // o PIX já foi registrado; respondemos 200 para a Asaas não reenviar
      }
    }

    return res.status(200).json({ ok: true, registrado: true, nome, valor: valorFmt });
  } catch (err) {
    console.error('[pix] erro:', err);
    return res.status(500).json({ ok: false, erro: err.message });
  }
};
