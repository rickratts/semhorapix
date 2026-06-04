# SHVPIX

Backend **independente** do SemHoraVendas. Réplica em Vercel Serverless do fluxo
N8N **"RECEBIMENTO PIX"**. Compartilha apenas a conta Vercel (projeto Vercel separado,
com deploy e domínio próprios) e o banco Supabase **semhorapix**.

## Estrutura

```
shvpix/
├── api/
│   └── pix.js       ← webhook de recebimento PIX (Asaas → Supabase → WhatsApp)
├── vercel.json
├── package.json
├── .env.example
└── README.md
```

## Webhook PIX

- **Arquivo:** `api/pix.js`
- **Endpoint:** `https://<seu-projeto>.vercel.app/api/pix`
- **Configurar na Asaas:** Webhooks → URL acima → evento `PAYMENT_RECEIVED`.

### Fluxo (idêntico ao N8N)
1. Recebe o POST da Asaas.
2. Busca o nome do cliente na API Asaas (`/v3/customers/{id}`).
3. Ignora se o cliente for `Appmax Plataforma Vendas Ltda`.
4. Formata valor (R$) e data/hora (pt-BR, +3h).
5. Insere na tabela `pix` do Supabase semhorapix (`empresa_id=2`, `status=true`).
6. Envia mensagem no grupo de WhatsApp via uazapi.
7. Se o envio falhar, espera 20s e tenta de novo uma vez.

## Variáveis de ambiente

Veja `.env.example`. Configure no painel da Vercel (Settings → Environment Variables):

| Variável | Obrigatória | Default |
|---|---|---|
| `SUPABASE_URL` | não | `https://xhzeruahwekxszyxtxwy.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **sim** | — |
| `ASAAS_ACCESS_TOKEN` | **sim** | — |
| `UAZAPI_URL` | não | `https://semhoravendas.uazapi.com` |
| `UAZAPI_TOKEN` | **sim** | — |
| `UAZAPI_GRUPO` | não | `120363407246179266` |
| `PIX_EMPRESA_ID` | não | `2` |

> A `SUPABASE_SERVICE_ROLE_KEY` é necessária porque a tabela `pix` tem RLS ativo —
> o service role ignora o RLS para inserir do backend.

## Deploy na Vercel (projeto independente)

1. Suba esta pasta para um repositório Git próprio.
2. Vercel → **Add New → Project** apontando para esse repo.
3. **Root Directory:** raiz do projeto (onde está o `vercel.json`).
4. Adicione as variáveis de ambiente.
5. Deploy. A URL final será `https://<nome-do-projeto>.vercel.app/api/pix`.

> A URL exata só existe após o primeiro deploy (a Vercel atribui o domínio
> `<nome-do-projeto>.vercel.app` na criação do projeto).
