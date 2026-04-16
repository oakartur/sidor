# SIDOR

Sistema web para documentacao operacional de rede corporativa: sites, VLANs, racks, switches, IPs de gerenciamento, links de internet, templates e auditoria.

## Decisao De Stack

A implementacao inicial usa TypeScript ponta a ponta:

- React/Vite para uma UI operacional simples e responsiva.
- Express para API modular com casos de uso explicitos.
- Prisma/PostgreSQL para migrations, constraints e acesso tipado ao banco.
- Docker Compose para execucao local e em VM Ubuntu Server 22.04.

Essa escolha prioriza uma UI web produtiva, regras de dominio testaveis fora do banco e uma estrutura simples de containers. As regras criticas ficam em `packages/domain`, nao em triggers.

## Regras Implementadas

- VLANs sao geradas a partir da VLAN1 `/24` do site e de incrementos relativos em `template_vlans`. Ex.: VLAN1 `10.20.25.0/24` com incremento `1` gera `10.20.26.0/24`.
- Switches sao gerados por rack usando `template_switch_slots`.
- IPs automaticos de switches usam os tres primeiros octetos da VLAN1 e a sequencia fixa: `.241` a `.250`, depois `.230` a `.239`.
- Acima de 20 switches por site, a geracao automatica e bloqueada.
- Hostname padrao: `R1SWCORE`, depois `R1SWA`, `R1SWB`; demais racks iniciam em `R{n}SWA`.
- O banco bloqueia duplicidade por site para VLAN, rede, rack, hostname e IP.
- Alteracoes importantes sao gravadas em `auditoria`.

## Desenvolvimento Local

```bash
npm install
npm run prisma:generate
npm run build
npm test
```

Para rodar com banco local via Docker:

```bash
cp .env.example .env
docker compose up -d --build
```

Acesse `http://localhost:1183`. O SIDOR reserva as portas locais `1183` para Nginx, `1184` para API e `15483` para PostgreSQL.

Credenciais iniciais padrao:

- email: `admin@sidor.local`
- senha: `troque-esta-senha`

Troque essas variaveis antes de producao.

## Bootstrap Na VM Ubuntu 22.04

1. Instale Docker Engine e o plugin Docker Compose.
2. Crie `/opt/sidor` e copie o projeto.
3. Crie `.env` a partir de `.env.example`.
4. Ajuste `POSTGRES_PASSWORD`, `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL` e `ADMIN_PASSWORD`.
5. Execute `chmod +x deploy.sh && ./deploy.sh`.
6. Verifique `docker compose logs -f api` e acesse `http://IP_DA_VM:1183`.

O Compose usa `network_mode: host`, entao o acesso deixa de usar a rede Docker bridge `172.x` e passa pelo IP real da VM. O Nginx escuta na porta `1183` e roteia `/api` para a API local em `127.0.0.1:1184`. O PostgreSQL do SIDOR escuta em `127.0.0.1:15483` e persiste no volume `postgres_data`.

Se a API falhar com `Prisma P1010`, o PostgreSQL aceitou conexao na porta, mas negou usuario/senha. Isso normalmente ocorre quando o volume `postgres_data` ja foi inicializado com outra senha: alterar `POSTGRES_PASSWORD` no `.env` nao troca a senha de um banco ja criado. Para ambiente sem dados, remova o volume com `docker compose down -v` e rode `./deploy.sh` novamente. Para preservar dados, altere a senha do usuario dentro do PostgreSQL e mantenha o `DATABASE_URL` igual ao `.env`.

## Estrutura

- `packages/domain`: regras puras de CIDR, VLAN, hostname e IP de switches.
- `apps/api`: API REST, Prisma, autenticação local, auditoria e casos de uso.
- `apps/web`: interface operacional para cadastro, consulta, preview e geração.
- `apps/api/prisma`: schema, migration inicial e seed de templates.

## Endpoints Principais

- `POST /api/auth/login`
- `GET /api/dashboard`
- `GET|POST /api/sites`
- `GET|PUT|DELETE /api/sites/:siteId`
- `GET /api/sites/:siteId/vlans/preview`
- `POST /api/sites/:siteId/vlans/generate`
- `GET /api/sites/:siteId/racks/suggest-next`
- `POST /api/sites/:siteId/racks`
- `GET /api/racks/:rackId/switches/preview`
- `POST /api/racks/:rackId/switches/generate`
- `GET|PUT /api/equipamentos`
- `GET /api/auditoria`

## Testes

Os testes de dominio cobrem:

- sequencia de IPs `.241-.250`, depois `.230-.239`;
- bloqueio acima de 20 switches;
- geracao de hostname;
- geracao de VLANs por template;
- prevencao de duplicidade na geracao de switches.
