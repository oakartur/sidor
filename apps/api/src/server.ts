import "dotenv/config";
import bcrypt from "bcryptjs";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { Prisma, PrismaClient, UserRole } from "@prisma/client";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { z } from "zod";
import {
  DomainError,
  buildSiteCode,
  buildSiteLabel,
  generateRackSwitches,
  generateVlans,
  parseIpv4Cidr
} from "@sidor/domain";

const prisma = new PrismaClient();
const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const app = express();
const jwtSecret = process.env.JWT_SECRET ?? "dev-secret-change-me";
const port = Number(process.env.API_PORT ?? 3000);
const host = process.env.API_HOST ?? "0.0.0.0";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: UserRole; email: string };
    }
  }
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "sidor-api" });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

app.post("/api/auth/login", asyncHandler(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !user.ativo) {
    return res.status(401).json({ error: "Credenciais invalidas" });
  }
  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Credenciais invalidas" });
  }
  const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, jwtSecret, { expiresIn: "8h" });
  res.json({ token, user: publicUser(user) });
}));

app.use("/api", authenticate);

app.get("/api/auth/me", asyncHandler(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  res.json(publicUser(user));
}));

app.get("/api/dashboard", asyncHandler(async (_req, res) => {
  const [sites, vlans, racks, equipamentos, conflitosRecentes] = await Promise.all([
    prisma.site.count({ where: { ativo: true } }),
    prisma.vlan.count({ where: { ativo: true } }),
    prisma.siteRack.count({ where: { ativo: true } }),
    prisma.equipamento.count({ where: { ativo: true } }),
    prisma.auditoria.findMany({ orderBy: { createdAt: "desc" }, take: 8 })
  ]);
  res.json({ sites, vlans, racks, equipamentos, ultimasAlteracoes: conflitosRecentes });
}));

const siteSchema = z.object({
  regional: z.string().min(1),
  bandeira: z.string().min(1),
  loja: z.string().min(1),
  labelSite: z.string().optional(),
  vlan1Cidr: z.string().min(1),
  ipSwitchInicial: z.number().int().min(1).max(254).default(241),
  endereco: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
  ativo: z.boolean().optional()
});

app.get("/api/sites", asyncHandler(async (req, res) => {
  const search = String(req.query.search ?? "").trim();
  const sites = await prisma.site.findMany({
    where: search
      ? {
          OR: [
            { codigoSite: { contains: search, mode: "insensitive" } },
            { labelSite: { contains: search, mode: "insensitive" } },
            { vlan1Cidr: { contains: search, mode: "insensitive" } }
          ]
        }
      : undefined,
    orderBy: [{ ativo: "desc" }, { labelSite: "asc" }],
    include: { _count: { select: { vlans: true, racks: true, equipamentos: true, linksInternet: true } } }
  });
  res.json(sites);
}));

app.post("/api/sites", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const input = siteSchema.parse(req.body);
  parseIpv4Cidr(input.vlan1Cidr);
  const codigoSite = buildSiteCode(input.regional, input.bandeira, input.loja);
  const site = await prisma.site.create({
    data: {
      ...input,
      codigoSite,
      labelSite: input.labelSite?.trim() || buildSiteLabel(input.regional, input.bandeira, input.loja)
    }
  });
  await audit(req, "sites", site.id, "CREATE", null, site);
  res.status(201).json(site);
}));

app.get("/api/sites/:siteId", asyncHandler(async (req, res) => {
  const site = await prisma.site.findUniqueOrThrow({
    where: { id: req.params.siteId },
    include: {
      vlans: { orderBy: { vlanId: "asc" } },
      racks: { orderBy: { rackNum: "asc" }, include: { equipamentos: { orderBy: { ordemNoRack: "asc" } } } },
      equipamentos: { orderBy: [{ ordemGlobal: "asc" }] },
      linksInternet: { include: { operadora: true } }
    }
  });
  res.json(site);
}));

app.put("/api/sites/:siteId", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const input = siteSchema.partial().parse(req.body);
  if (input.vlan1Cidr) {
    parseIpv4Cidr(input.vlan1Cidr);
  }
  const before = await prisma.site.findUniqueOrThrow({ where: { id: req.params.siteId } });
  const regional = input.regional ?? before.regional;
  const bandeira = input.bandeira ?? before.bandeira;
  const loja = input.loja ?? before.loja;
  const shouldUpdateIdentity = input.regional !== undefined || input.bandeira !== undefined || input.loja !== undefined;
  const after = await prisma.site.update({
    where: { id: req.params.siteId },
    data: {
      ...input,
      codigoSite: shouldUpdateIdentity ? buildSiteCode(regional, bandeira, loja) : undefined,
      labelSite: input.labelSite ?? (shouldUpdateIdentity ? buildSiteLabel(regional, bandeira, loja) : undefined)
    }
  });
  await audit(req, "sites", after.id, "UPDATE", before, after, req.body.motivo);
  res.json(after);
}));

app.delete("/api/sites/:siteId", requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const before = await prisma.site.findUniqueOrThrow({ where: { id: req.params.siteId } });
  const after = await prisma.site.update({ where: { id: req.params.siteId }, data: { ativo: false } });
  await audit(req, "sites", after.id, "DEACTIVATE", before, after);
  res.json(after);
}));

const vlanManualSchema = z.object({
  vlanId: z.number().int().positive(),
  vlanNome: z.string().min(1),
  redeCidr: z.string().min(1),
  dhcpInicio: z.string().min(1),
  dhcpFim: z.string().min(1),
  gateway: z.string().min(1),
  tipoAcessoInternet: z.string().min(1),
  ativo: z.boolean().default(true)
});

app.post("/api/sites/:siteId/vlans", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const input = vlanManualSchema.parse(req.body);
  const vlan = await prisma.vlan.create({ data: { ...input, siteId: req.params.siteId } });
  await audit(req, "vlans", vlan.id, "CREATE", null, vlan);
  res.status(201).json(vlan);
}));

app.get("/api/sites/:siteId/vlans/preview", asyncHandler(async (req, res) => {
  const template = String(req.query.template ?? "PADRAO");
  const preview = await previewVlans(req.params.siteId, template);
  res.json(preview);
}));

app.post("/api/sites/:siteId/vlans/generate", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const schema = z.object({ template: z.string().default("PADRAO"), confirm: z.literal(true) });
  const input = schema.parse(req.body);
  const preview = await previewVlans(req.params.siteId, input.template);
  const conflicts = preview.filter((item) => item.conflict);
  if (conflicts.length > 0) {
    return res.status(409).json({ error: "Conflitos impedem a geracao", conflicts });
  }
  const created = await prisma.vlan.createMany({
    data: preview.map((item) => ({
      siteId: req.params.siteId,
      vlanId: item.vlanId,
      vlanNome: item.vlanNome,
      redeCidr: item.redeCidr,
      dhcpInicio: item.dhcpInicio,
      dhcpFim: item.dhcpFim,
      gateway: item.gateway,
      tipoAcessoInternet: item.tipoAcessoInternet,
      ativo: true
    }))
  });
  await audit(req, "sites", req.params.siteId, "GENERATE_VLANS", null, preview, `template=${input.template}`);
  res.status(201).json({ created: created.count, items: preview });
}));

app.put("/api/vlans/:vlanId", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const input = vlanManualSchema.partial().parse(req.body);
  const before = await prisma.vlan.findUniqueOrThrow({ where: { id: req.params.vlanId } });
  const after = await prisma.vlan.update({ where: { id: req.params.vlanId }, data: input });
  await audit(req, "vlans", after.id, "UPDATE", before, after, req.body.motivo);
  res.json(after);
}));

const rackSchema = z.object({
  rackNum: z.number().int().positive(),
  localRack: z.string().min(1),
  qtdSwitches: z.number().int().positive(),
  ativo: z.boolean().default(true)
});

app.get("/api/sites/:siteId/racks/suggest-next", asyncHandler(async (req, res) => {
  const latest = await prisma.siteRack.findFirst({
    where: { siteId: req.params.siteId },
    orderBy: { rackNum: "desc" }
  });
  res.json({ rackNum: (latest?.rackNum ?? 0) + 1 });
}));

app.post("/api/sites/:siteId/racks", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const input = rackSchema.parse(req.body);
  const rack = await prisma.siteRack.create({ data: { ...input, siteId: req.params.siteId } });
  await audit(req, "site_racks", rack.id, "CREATE", null, rack);
  res.status(201).json(rack);
}));

app.put("/api/racks/:rackId", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const input = rackSchema.partial().parse(req.body);
  const before = await prisma.siteRack.findUniqueOrThrow({ where: { id: req.params.rackId } });
  const after = await prisma.siteRack.update({ where: { id: req.params.rackId }, data: input });
  await audit(req, "site_racks", after.id, "UPDATE", before, after, req.body.motivo);
  res.json(after);
}));

app.get("/api/racks/:rackId/switches/preview", asyncHandler(async (req, res) => {
  const preview = await previewRackSwitches(req.params.rackId);
  res.json(preview);
}));

app.post("/api/racks/:rackId/switches/generate", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  z.object({ confirm: z.literal(true) }).parse(req.body);
  const rack = await prisma.siteRack.findUniqueOrThrow({
    where: { id: req.params.rackId },
    include: { site: true }
  });
  const preview = await previewRackSwitches(req.params.rackId);
  const conflicts = preview.filter((item) => item.conflict);
  if (conflicts.length > 0) {
    return res.status(409).json({ error: "Conflitos impedem a geracao", conflicts });
  }

  const created = await prisma.equipamento.createMany({
    data: preview.map((item) => ({
      siteId: rack.siteId,
      rackId: rack.id,
      tipoEquipamento: item.tipoEquipamento,
      hostname: item.hostname,
      ipGerenciamento: item.ipGerenciamento,
      localRack: rack.localRack,
      rackNum: rack.rackNum,
      ordemNoRack: item.ordemNoRack,
      ordemGlobal: item.ordemGlobal,
      papelSwitch: item.papelSwitch,
      ativo: true
    }))
  });
  await audit(req, "site_racks", rack.id, "GENERATE_SWITCHES", null, preview);
  res.status(201).json({ created: created.count, items: preview });
}));

const equipmentManualSchema = z.object({
  rackId: z.string().uuid(),
  tipoEquipamento: z.string().default("SWITCH"),
  hostname: z.string().min(1),
  ipGerenciamento: z.string().min(1),
  localRack: z.string().min(1),
  rackNum: z.number().int().positive(),
  ordemNoRack: z.number().int().positive(),
  ordemGlobal: z.number().int().positive(),
  papelSwitch: z.string().min(1),
  observacao: z.string().optional().nullable(),
  ativo: z.boolean().default(true)
});

app.get("/api/equipamentos", asyncHandler(async (req, res) => {
  const siteId = req.query.siteId ? String(req.query.siteId) : undefined;
  const rackId = req.query.rackId ? String(req.query.rackId) : undefined;
  const search = String(req.query.search ?? "").trim();
  const equipamentos = await prisma.equipamento.findMany({
    where: {
      siteId,
      rackId,
      ...(search
        ? {
            OR: [
              { hostname: { contains: search, mode: "insensitive" } },
              { ipGerenciamento: { contains: search, mode: "insensitive" } },
              { localRack: { contains: search, mode: "insensitive" } }
            ]
          }
        : {})
    },
    include: { site: true, rack: true },
    orderBy: [{ site: { labelSite: "asc" } }, { ordemGlobal: "asc" }]
  });
  res.json(equipamentos);
}));

app.post("/api/sites/:siteId/equipamentos", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const input = equipmentManualSchema.parse(req.body);
  const equipamento = await prisma.equipamento.create({
    data: { ...input, siteId: req.params.siteId, editadoManual: true }
  });
  await audit(req, "equipamentos", equipamento.id, "CREATE_MANUAL", null, equipamento);
  res.status(201).json(equipamento);
}));

app.put("/api/equipamentos/:equipamentoId", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const input = equipmentManualSchema.partial().extend({ motivo: z.string().optional() }).parse(req.body);
  const { motivo, ...data } = input;
  const before = await prisma.equipamento.findUniqueOrThrow({ where: { id: req.params.equipamentoId } });
  const after = await prisma.equipamento.update({
    where: { id: req.params.equipamentoId },
    data: { ...data, editadoManual: true }
  });
  await audit(req, "equipamentos", after.id, "UPDATE_MANUAL", before, after, motivo);
  res.json(after);
}));

app.delete("/api/equipamentos/:equipamentoId", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const before = await prisma.equipamento.findUniqueOrThrow({ where: { id: req.params.equipamentoId } });
  const after = await prisma.equipamento.update({ where: { id: req.params.equipamentoId }, data: { ativo: false, editadoManual: true } });
  await audit(req, "equipamentos", after.id, "DEACTIVATE", before, after);
  res.json(after);
}));

app.get("/api/templates/vlans", asyncHandler(async (_req, res) => {
  res.json(await prisma.templateVlan.findMany({ orderBy: [{ dblabel: "asc" }, { vlanId: "asc" }] }));
}));

const templateVlanBaseSchema = z.object({
  dblabel: z.string().min(1),
  vlanId: z.number().int().positive(),
  vlanNome: z.string().min(1),
  baseOcteto: z.number().int().min(0).max(255),
  dhcpInicio: z.number().int().min(1).max(254),
  dhcpFim: z.number().int().min(1).max(254),
  tipoAcessoInternet: z.string().min(1),
  gatewayTemplate: z.number().int().min(1).max(254),
  ativo: z.boolean().default(true)
});

const templateVlanSchema = templateVlanBaseSchema.refine((value) => value.dhcpInicio <= value.dhcpFim, {
  message: "dhcp_inicio deve ser menor ou igual a dhcp_fim",
  path: ["dhcpFim"]
});

app.post("/api/templates/vlans", requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const template = await prisma.templateVlan.create({ data: templateVlanSchema.parse(req.body) });
  await audit(req, "template_vlans", template.id, "CREATE", null, template);
  res.status(201).json(template);
}));

app.put("/api/templates/vlans/:templateId", requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const input = templateVlanBaseSchema.partial().refine((value) => {
    if (value.dhcpInicio === undefined || value.dhcpFim === undefined) return true;
    return value.dhcpInicio <= value.dhcpFim;
  }, {
    message: "dhcp_inicio deve ser menor ou igual a dhcp_fim",
    path: ["dhcpFim"]
  }).parse(req.body);
  const before = await prisma.templateVlan.findUniqueOrThrow({ where: { id: req.params.templateId } });
  const after = await prisma.templateVlan.update({ where: { id: req.params.templateId }, data: input });
  await audit(req, "template_vlans", after.id, "UPDATE", before, after);
  res.json(after);
}));

app.get("/api/templates/switch-slots", asyncHandler(async (_req, res) => {
  res.json(await prisma.templateSwitchSlot.findMany({ orderBy: { slotNum: "asc" } }));
}));

app.post("/api/templates/switch-slots", requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const schema = z.object({
    slotNum: z.number().int().positive(),
    sufixoNormal: z.string().min(1),
    sufixoR1: z.string().min(1),
    papelSwitch: z.enum(["CORE", "ACCESS"]),
    ativo: z.boolean().default(true)
  });
  const slot = await prisma.templateSwitchSlot.create({ data: schema.parse(req.body) });
  await audit(req, "template_switch_slots", slot.id, "CREATE", null, slot);
  res.status(201).json(slot);
}));

app.get("/api/operadoras", asyncHandler(async (_req, res) => {
  res.json(await prisma.operadora.findMany({ orderBy: { nome: "asc" } }));
}));

app.post("/api/operadoras", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const schema = z.object({
    nome: z.string().min(1),
    contato: z.string().optional().nullable(),
    telefone: z.string().optional().nullable(),
    observacao: z.string().optional().nullable(),
    ativo: z.boolean().default(true)
  });
  const operadora = await prisma.operadora.create({ data: schema.parse(req.body) });
  await audit(req, "operadoras", operadora.id, "CREATE", null, operadora);
  res.status(201).json(operadora);
}));

app.post("/api/sites/:siteId/links-internet", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const schema = z.object({
    operadoraId: z.string().uuid().optional().nullable(),
    nomeLink: z.string().min(1),
    tipo: z.string().min(1),
    ipWan: z.string().optional().nullable(),
    gatewayWan: z.string().optional().nullable(),
    mascaraOuCidr: z.string().optional().nullable(),
    dns1: z.string().optional().nullable(),
    dns2: z.string().optional().nullable(),
    ativo: z.boolean().default(true),
    observacao: z.string().optional().nullable()
  });
  const link = await prisma.linkInternet.create({ data: { ...schema.parse(req.body), siteId: req.params.siteId } });
  await audit(req, "links_internet", link.id, "CREATE", null, link);
  res.status(201).json(link);
}));

app.post("/api/vlans/:vlanId/acessos-internet", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const schema = z.object({
    linkInternetId: z.string().uuid(),
    modoAcesso: z.string().min(1),
    observacao: z.string().optional().nullable()
  });
  const acesso = await prisma.vlanAcessoInternet.create({ data: { ...schema.parse(req.body), vlanId: req.params.vlanId } });
  await audit(req, "vlan_acesso_internet", acesso.id, "CREATE", null, acesso);
  res.status(201).json(acesso);
}));

app.get("/api/auditoria", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const entidade = req.query.entidade ? String(req.query.entidade) : undefined;
  const entidadeId = req.query.entidadeId ? String(req.query.entidadeId) : undefined;
  const auditoria = await prisma.auditoria.findMany({
    where: { entidade, entidadeId },
    include: { actor: { select: { id: true, nome: true, email: true, role: true } } },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  res.json(auditoria);
}));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: "Entrada invalida", details: error.flatten() });
  }
  if (error instanceof DomainError) {
    return res.status(422).json({ error: error.message });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return res.status(409).json({ error: "Registro duplicado", meta: error.meta });
  }
  logger.error(error);
  return res.status(500).json({ error: "Erro interno" });
});

app.listen(port, host, () => {
  logger.info({ host, port }, "Sidor API listening");
});

async function previewVlans(siteId: string, templateLabel: string) {
  const [site, templates, existing] = await Promise.all([
    prisma.site.findUniqueOrThrow({ where: { id: siteId } }),
    prisma.templateVlan.findMany({ where: { dblabel: templateLabel, ativo: true }, orderBy: { vlanId: "asc" } }),
    prisma.vlan.findMany({ where: { siteId } })
  ]);
  const existingVlanIds = new Set(existing.map((item) => item.vlanId));
  const existingCidrs = new Set(existing.map((item) => item.redeCidr));
  return generateVlans(site.vlan1Cidr, templates).map((item) => ({
    ...item,
    conflict: existingVlanIds.has(item.vlanId) || existingCidrs.has(item.redeCidr)
  }));
}

async function previewRackSwitches(rackId: string) {
  const rack = await prisma.siteRack.findUniqueOrThrow({
    where: { id: rackId },
    include: { site: true }
  });
  const [existing, slots] = await Promise.all([
    prisma.equipamento.findMany({
      where: { siteId: rack.siteId },
      orderBy: { ordemGlobal: "asc" }
    }),
    prisma.templateSwitchSlot.findMany({ where: { ativo: true }, orderBy: { slotNum: "asc" } })
  ]);
  const generated = generateRackSwitches({
    vlan1Cidr: rack.site.vlan1Cidr,
    rackNum: rack.rackNum,
    qtdSwitches: rack.qtdSwitches,
    existingSwitches: existing.map((item) => ({
      hostname: item.hostname,
      ipGerenciamento: item.ipGerenciamento,
      ordemGlobal: item.ordemGlobal
    })),
    slotTemplates: slots.map((slot) => ({
      slotNum: slot.slotNum,
      sufixoNormal: slot.sufixoNormal,
      sufixoR1: slot.sufixoR1,
      papelSwitch: slot.papelSwitch === "CORE" ? "CORE" : "ACCESS",
      ativo: slot.ativo
    }))
  });
  const hostnames = new Set(existing.map((item) => item.hostname.toUpperCase()));
  const ips = new Set(existing.map((item) => item.ipGerenciamento));
  return generated.map((item) => ({
    ...item,
    conflict: hostnames.has(item.hostname.toUpperCase()) || ips.has(item.ipGerenciamento)
  }));
}

function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    return res.status(401).json({ error: "Token ausente" });
  }
  try {
    const decoded = jwt.verify(token, jwtSecret) as { sub: string; role: UserRole; email: string };
    req.user = { id: decoded.sub, role: decoded.role, email: decoded.email };
    next();
  } catch {
    return res.status(401).json({ error: "Token invalido" });
  }
}

function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Permissao insuficiente" });
    }
    next();
  };
}

function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

async function audit(req: Request, entidade: string, entidadeId: string, acao: string, before: unknown, after: unknown, motivo?: string | null) {
  await prisma.auditoria.create({
    data: {
      actorUserId: req.user?.id,
      entidade,
      entidadeId,
      acao,
      antesJson: jsonOrNull(before),
      depoisJson: jsonOrNull(after),
      motivo: motivo ?? undefined
    }
  });
}

function jsonOrNull(value: unknown) {
  return value === null || value === undefined ? Prisma.JsonNull : JSON.parse(JSON.stringify(value));
}

function publicUser(user: { id: string; nome: string; email: string; role: UserRole; ativo: boolean }) {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    role: user.role,
    ativo: user.ativo
  };
}
