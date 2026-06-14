# PRD — Insights Agent (Bounty Week 4)

> **Tipo de documento:** Product Requirements Document (PRD) orientado a implementación por agente de coding  
> **Objetivo:** Construir un Commerce Agent sobre Hedera que venda análisis on-chain en tiempo real, pagado por request en HBAR via x402, con UI conversacional para humanos y endpoints ACP para agentes.  
> **Repositorio:** Público en GitHub  
> **Deploy:** URL viva mínimo 90 días

---

## 1. Contexto y Requisitos del Bounty

### Requisitos obligatorios
- Public GitHub repository
- Built using **Hedera Agent Kit JS**: https://github.com/hashgraph/hedera-agent-kit-js
- Live demo agent URL (hosted)
- Hosted URL disponible mínimo 90 días post-submission
- Submit feedback on AI Studio tools
- Payments deben **gatear** acceso a capabilities o workflows

### Diferenciadores que el bounty valora explícitamente
- Implementaciones que usen: **AP2**, **ACP**, **UCP**, **MPP**
- Los agentes enviados serán **indexados en el ecosistema Hedera**

### Links de referencia del bounty
- Bounty hub: https://ai-bounties.hedera.com/
- Hedera Agent Kit JS: https://github.com/hashgraph/hedera-agent-kit-js
- AI Studio docs: https://docs.hedera.com/hedera/open-source-solutions/ai-studio-on-hedera
- x402 en Hedera: https://docs.hedera.com/solutions/ai/x402
- ACP spec: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
- AP2: https://github.com/google-agentic-commerce/AP2
- MPPx: https://github.com/wevm/mppx
- Hedera Quickstart JS: https://docs.hedera.com/hedera/open-source-solutions/ai-studio-on-hedera/hedera-ai-agent-kit/hedera-agent-kit-js/quickstart
- Scaffold CLI: `npm create hedera-agent@latest`

---

## 2. Descripción del Producto

**Insights Agent** es un agente conversacional que expone servicios de inteligencia on-chain de la red Hedera detrás de micropagos en HBAR. Cada query al mirror node de Hedera representa un dato que **no existe en ninguna otra fuente** y que ningún LLM puede responder con datos frescos — lo que garantiza que el pago tenga valor real.

### Propuesta de valor
- Para **humanos**: chat UI donde preguntan sobre cuentas, tokens y topics de Hedera en lenguaje natural y pagan por cada insight.
- Para **agentes AI externos**: endpoints ACP que permiten a cualquier buyer-agent descubrir el catálogo, comprar, pagar en HBAR via x402, y recibir el fulfillment automáticamente.

---

## 3. Servicios que vende el agente (Catálogo)

Cada servicio consume el mirror node de Hedera y devuelve datos en tiempo real.

| service_id | Nombre | Descripción | Precio (HBAR) |
|---|---|---|---|
| `account-intelligence` | Account Intelligence | Balance actual, últimas 10 txs, tokens asociados, actividad reciente | 2 HBAR |
| `token-report` | Token Report | Supply total, top 10 holders, transfers últimas 24h de un HTS token | 3 HBAR |
| `topic-feed` | Topic Feed | Últimos N mensajes de un topic HCS con timestamps y contenido | 1 HBAR |
| `network-pulse` | Network Pulse | TPS actual, fees promedio, total txs últimas 24h de la red | 1 HBAR |
| `wallet-forensics` | Wallet Forensics | Grafo de relaciones de una cuenta: contrapartes frecuentes, volumen | 5 HBAR |

> **Fuente de datos:** Hedera Mirror Node REST API — https://docs.hedera.com/hedera/sdks-and-apis/rest-api  
> No requiere autenticación para queries públicos. Testnet mirror: `https://testnet.mirrornode.hedera.com`

---

## 4. Arquitectura del Sistema

### Stack tecnológico

| Capa | Tecnología | Rol |
|---|---|---|
| Frontend | Next.js 14 (App Router) | Chat UI + Wallet Connect |
| Backend / Agent | Node.js + Express | API server + Agent runtime |
| AI Agent | Hedera Agent Kit JS (LangChain) | Orquestación de tools y LLM |
| Payment gate | `@x402/hedera` + Blocky402 | Middleware x402 sobre HBAR |
| Commerce protocol | ACP spec (3 endpoints JSON) | Interoperabilidad con buyer agents |
| Blockchain | Hedera Testnet | Todas las transacciones |
| Deploy | Railway (free tier) | Hosting frontend + backend |

### Estructura de carpetas del repositorio

```
hedera-insights-agent/
├── packages/
│   ├── agent/                  # Backend Node.js + Express
│   │   ├── src/
│   │   │   ├── agent/
│   │   │   │   ├── index.ts            # Hedera Agent Kit setup + LangChain
│   │   │   │   ├── tools/
│   │   │   │   │   ├── accountIntelligence.ts
│   │   │   │   │   ├── tokenReport.ts
│   │   │   │   │   ├── topicFeed.ts
│   │   │   │   │   ├── networkPulse.ts
│   │   │   │   │   └── walletForensics.ts
│   │   │   ├── middleware/
│   │   │   │   └── x402.ts             # x402 resource server middleware
│   │   │   ├── routes/
│   │   │   │   ├── insights.ts         # POST /insights — endpoint gateado
│   │   │   │   ├── catalog.ts          # GET /catalog — ACP
│   │   │   │   ├── checkout.ts         # POST /checkout_session — ACP
│   │   │   │   └── orders.ts           # GET /orders/:id — ACP
│   │   │   └── server.ts               # Express app entry point
│   │   ├── package.json
│   │   └── .env.example
│   └── web/                    # Frontend Next.js
│       ├── app/
│       │   ├── page.tsx                # Chat UI principal
│       │   ├── catalog/page.tsx        # Catálogo de servicios (visual)
│       │   └── api/
│       │       └── chat/route.ts       # Proxy al backend agent
│       ├── components/
│       │   ├── ChatInterface.tsx
│       │   ├── WalletConnectButton.tsx
│       │   ├── PaymentConfirmModal.tsx
│       │   └── ServiceCard.tsx
│       └── package.json
├── README.md
└── package.json                # Workspace root (pnpm workspaces)
```

---

## 5. Componentes Técnicos — Especificación Detallada

### 5.1 Hedera Agent Kit Setup

**Referencia:** https://docs.hedera.com/hedera/open-source-solutions/ai-studio-on-hedera/hedera-ai-agent-kit/hedera-agent-kit-js/quickstart

El agente se inicializa con `HederaAgentKit` pasándole `accountId`, `privateKey` y `network: "testnet"`. Se usa `HederaLangchainToolkit` para exponer las tools nativas del kit al LLM.

**Tools nativas del Agent Kit que se usan directamente:**
- `getAccountBalance` — balance de una cuenta
- `getAccountInfo` — información completa de cuenta
- `getTokenInfo` — metadata de un HTS token

**Custom tools que debes implementar** (llaman directamente al Mirror Node REST API):
- `getAccountTransactions` — últimas N txs de una cuenta
- `getTopicMessages` — mensajes de un topic HCS
- `getNetworkStats` — métricas globales de la red
- `getTokenHolders` — top holders de un token
- `getAccountRelationships` — contrapartes frecuentes de una cuenta

Cada custom tool implementa la interfaz `DynamicStructuredTool` de LangChain con `name`, `description`, `schema` (Zod), y `func`.

**Variables de entorno requeridas para el agent:**
```
HEDERA_ACCOUNT_ID=0.0.XXXXXX
HEDERA_PRIVATE_KEY=302e...
HEDERA_NETWORK=testnet
DEEPSEEK_API_KEY=sk-...
```

---

### 5.2 x402 Payment Middleware

**Referencia:** https://docs.hedera.com/solutions/ai/x402

**Paquetes requeridos:**
- `@x402/core` — cliente y servidor base
- `@x402/hedera` — scheme específico para HBAR/HTS
- `@x402/node` — middleware Express/Node.js

**Configuración del Resource Server:**
- Facilitator URL (testnet): `https://api.testnet.blocky402.com` — no requiere API key
- Asset nativo HBAR: `{ asset: "0.0.0", decimals: 8 }` en `hedera:testnet`
- Cada servicio tiene su `price` en tinybars (1 HBAR = 100,000,000 tinybars)

**Endpoint gateado:** `POST /insights`  
- Sin `X-PAYMENT` header válido → responde `402 Payment Required` con `PaymentRequirements`
- Con `X-PAYMENT` header válido → el middleware verifica via Blocky402 → si ok, ejecuta el agent

**El frontend debe:**
1. Recibir el `402` con `PaymentRequirements`
2. Mostrar modal de confirmación al usuario con el precio en HBAR
3. Usar HashPack/WalletConnect para que el usuario firme la tx
4. Construir el `PaymentPayload` y reintentar el request con el header `X-PAYMENT`

**Referencia del esquema x402/hedera:** https://github.com/hashgraph/hedera-agent-kit-js (ver sección x402)

---

### 5.3 ACP Endpoints

**Referencia spec:** https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/tree/main/spec/2026-04-17

Son 3 rutas Express en `packages/agent/src/routes/`.

#### `GET /catalog`
Devuelve la lista de servicios del agente. No requiere pago ni autenticación.

**Response schema:**
```json
{
  "agent": {
    "name": "Hedera Insights Agent",
    "description": "Real-time on-chain intelligence for the Hedera network",
    "version": "1.0.0"
  },
  "services": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "price": { "amount": "string", "currency": "HBAR" },
      "params_schema": { /* JSON Schema del input requerido */ }
    }
  ]
}
```

#### `POST /checkout_session`
Inicia una sesión de compra. No ejecuta el servicio aún — solo reserva y devuelve el `payment_handler`.

**Request:**
```json
{ "service_id": "string", "params": { /* según params_schema del servicio */ } }
```

**Response:**
```json
{
  "session_id": "string",
  "status": "pending_payment",
  "payment_handler": {
    "type": "x402",
    "chain": "hedera:testnet",
    "amount": "string",
    "asset": "0.0.0",
    "payTo": "0.0.TREASURY_ACCOUNT"
  },
  "expires_at": "ISO8601 timestamp"
}
```

Las sesiones se guardan en memoria (Map en Node.js). No se necesita DB para el MVP.

#### `GET /orders/:session_id`
Devuelve el estado del fulfillment.

**Response (fulfilled):**
```json
{
  "session_id": "string",
  "status": "fulfilled",
  "service_id": "string",
  "result": { /* output del agente según el servicio */ },
  "tx_proof": "https://hashscan.io/testnet/transaction/...",
  "fulfilled_at": "ISO8601 timestamp"
}
```

**Flujo de fulfillment:** cuando el buyer agent paga via `POST /insights` con x402 válido, el middleware verifica el pago, ejecuta el agent, y actualiza la sesión en el Map con `status: "fulfilled"` y el `result`.

---

### 5.4 Frontend Chat UI

**Framework:** Next.js 14 con App Router. Se puede scaffoldear con `npm create hedera-agent@latest` que ya incluye la base de Next.js + Agent Kit + WalletConnect.

**Referencia scaffold:** https://www.npmjs.com/package/create-hedera-agent

#### Componentes requeridos

**`ChatInterface.tsx`**
- Input de texto libre para el usuario
- Historial de mensajes (array en state local)
- Cuando el agente responde con datos on-chain, mostrar un badge "Verified on Hedera" con link a HashScan
- Streaming de respuesta del agente (SSE o WebSocket)

**`WalletConnectButton.tsx`**
- Integración con **HashPack** via WalletConnect v2
- Muestra el accountId conectado y el balance en HBAR
- Referencia: https://docs.hedera.com/hedera/open-source-solutions/wallets-and-extensions

**`PaymentConfirmModal.tsx`**
- Se muestra cuando el backend devuelve 402
- Muestra: servicio solicitado, precio en HBAR, accountId del destinatario
- Botón "Confirmar pago" → llama a HashPack para firmar
- Botón "Cancelar"
- Estado de loading mientras Blocky402 verifica

**`ServiceCard.tsx`**
- Tarjeta visual por cada servicio del catálogo
- Nombre, descripción, precio, botón "Try it"
- Al clickar, pre-rellena el chat con el comando

#### Página principal `app/page.tsx`
- Layout: sidebar izquierdo con catálogo de servicios, área principal con chat
- Header con `WalletConnectButton`
- No requiere autenticación — el pago es el acceso

---

### 5.5 Wallet Integration

**Wallet soportada:** HashPack (wallet oficial de Hedera)  
**Protocolo:** WalletConnect v2  
**Referencia:** https://docs.hedera.com/hedera/open-source-solutions/wallets-and-extensions  
**Paquete sugerido:** `@hashgraph/sdk` + `@walletconnect/web3wallet`

**Flujo de firma:**
1. Usuario conecta HashPack → frontend obtiene `accountId` del usuario
2. Cuando hay un `PaymentRequirements` x402, el frontend construye una `TransferTransaction` de HBAR
3. La tx se propone a HashPack para firma
4. HashPack firma → frontend obtiene el `PaymentPayload` firmado
5. Frontend reintenta el request con el header `X-PAYMENT: <base64(PaymentPayload)>`

---

## 6. Flujos de Usuario

### Flujo Humano (Chat UI)

```
1. Usuario abre la URL del agente deployado
2. Conecta HashPack wallet → ve su balance en HBAR
3. Escribe: "Analiza la cuenta 0.0.1234567"
4. Frontend llama POST /insights
5. Backend responde 402 + PaymentRequirements { amount: 2 HBAR }
6. Frontend muestra PaymentConfirmModal
7. Usuario confirma → HashPack firma la tx
8. Frontend reintenta POST /insights con X-PAYMENT header
9. Blocky402 verifica la tx en testnet
10. Agent Kit ejecuta tools → mirror node → análisis
11. Chat muestra resultado con badge "Verified" + link HashScan
```

### Flujo Agente-a-Agente (ACP)

```
1. Buyer agent GET /catalog → descubre servicios disponibles
2. Buyer agent POST /checkout_session { service_id, params }
3. Tu agente responde con payment_handler x402
4. Buyer agent paga HBAR via x402 (tiene wallet propia)
5. Buyer agent POST /insights con X-PAYMENT header
6. Tu agente ejecuta → devuelve resultado
7. Buyer agent GET /orders/:id → confirma status "fulfilled"
```

---

## 7. Variables de Entorno

### Backend (`packages/agent/.env`)
```
# Hedera
HEDERA_ACCOUNT_ID=           # 0.0.XXXXXX — treasury account del servicio
HEDERA_PRIVATE_KEY=          # ED25519 o ECDSA private key
HEDERA_NETWORK=testnet

# LLM
DEEPSEEK_API_KEY=              # Para el agente LangChain

# x402
X402_FACILITATOR_URL=https://api.testnet.blocky402.com

# Server
PORT=3001
CORS_ORIGIN=http://localhost:3000
```

### Frontend (`packages/web/.env.local`)
```
NEXT_PUBLIC_AGENT_URL=       # URL del backend (local o Railway)
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=  # De cloud.walletconnect.com
NEXT_PUBLIC_HEDERA_NETWORK=testnet
```

---

## 8. Deploy

### Backend en Railway
- Conectar repo GitHub → auto-deploy desde `packages/agent`
- `Start command`: `node dist/server.js`
- `Build command`: `npm run build`
- Variables de entorno en Railway dashboard

### Frontend en Railway (o Vercel)
- Auto-deploy desde `packages/web`
- Variable `NEXT_PUBLIC_AGENT_URL` apunta al backend deployado
- URL resultante es la **Live Demo URL** para el submission

### Requisito de 90 días
- Railway free tier mantiene el deploy activo con tráfico mínimo
- Agregar un cron health-check cada 14 días para evitar sleep (Railway free duerme sin tráfico)

---

## 9. README requerido para el submission

El README del repo debe incluir:

1. **Descripción del proyecto** — qué hace, por qué es útil
2. **Live Demo URL** — link al agente deployado
3. **Stack** — Hedera Agent Kit JS, x402, ACP, Mirror Node
4. **Cómo usar** — pasos para conectar wallet y hacer la primera query
5. **Arquitectura** — diagrama ASCII del flujo
6. **Setup local** — `npm install`, configurar `.env`, `npm run dev`
7. **Servicios disponibles** — tabla con los 5 servicios y precios
8. **Feedback** — link al GitHub issue / feature request en un repo de Hedera AI Studio (obligatorio para el submission)

---

## 10. Criterios de Aceptación del MVP

El agente está listo para submission cuando:

- [ ] `GET /catalog` devuelve los 5 servicios con precios correctos
- [ ] `POST /insights` sin pago devuelve `402 Payment Required`
- [ ] `POST /insights` con `X-PAYMENT` válido ejecuta el agente y devuelve datos reales del mirror node
- [ ] `POST /checkout_session` + `GET /orders/:id` funcionan (flujo ACP completo)
- [ ] Chat UI permite escribir en lenguaje natural y recibe respuestas del agente
- [ ] `WalletConnectButton` conecta HashPack correctamente
- [ ] `PaymentConfirmModal` aparece ante un 402 y permite firmar desde HashPack
- [ ] Respuestas del agente incluyen tx hash verificable en HashScan
- [ ] Deploy en Railway con URL viva
- [ ] README completo con todos los campos del bounty
- [ ] Feedback submitteado en un repo de Hedera AI Studio

---

## 11. Nice to Have (si sobra tiempo)

- **AP2 support**: validar credenciales AP2 en el header del buyer agent antes del checkout (referencia: https://github.com/google-agentic-commerce/AP2)
- **MPP sessions**: usar MPPx para sesiones multi-query donde el usuario paga una vez y hace N queries (referencia: https://github.com/wevm/mppx)
- **Streaming responses**: SSE desde el backend para mostrar la respuesta del agente en tiempo real en el chat
- **Saved queries**: el usuario puede guardar una query para re-ejecutarla con un clic
- **Dark mode**: UI con toggle light/dark

---

## 12. Referencias Consolidadas

| Recurso | URL |
|---|---|
| Hedera Agent Kit JS (repo) | https://github.com/hashgraph/hedera-agent-kit-js |
| Agent Kit JS Quickstart | https://docs.hedera.com/hedera/open-source-solutions/ai-studio-on-hedera/hedera-ai-agent-kit/hedera-agent-kit-js/quickstart |
| Scaffold CLI (`create-hedera-agent`) | https://www.npmjs.com/package/create-hedera-agent |
| x402 en Hedera (docs) | https://docs.hedera.com/solutions/ai/x402 |
| Blocky402 Facilitator (testnet) | https://api.testnet.blocky402.com |
| Mirror Node REST API | https://docs.hedera.com/hedera/sdks-and-apis/rest-api |
| Mirror Node Testnet Base URL | https://testnet.mirrornode.hedera.com/api/v1 |
| ACP Spec (OpenAI + Stripe) | https://github.com/agentic-commerce-protocol/agentic-commerce-protocol |
| AP2 (Google) | https://github.com/google-agentic-commerce/AP2 |
| MPPx (wevm) | https://github.com/wevm/mppx |
| HashPack / WalletConnect | https://docs.hedera.com/hedera/open-source-solutions/wallets-and-extensions |
| HashScan Testnet Explorer | https://hashscan.io/testnet |
| AI Studio on Hedera | https://docs.hedera.com/hedera/open-source-solutions/ai-studio-on-hedera |
| Bounty Hub | https://ai-bounties.hedera.com/ |
