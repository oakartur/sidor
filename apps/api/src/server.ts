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
import { loadTemplateWorkbook, loadWorkbookFromBuffer, patchWorkbook, readSheetCells } from "./xlsx-template.js";

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
      racks: { orderBy: { rackNum: "asc" }, include: { equipamentos: { orderBy: { ordemNoRack: "asc" } }, patchPanels: { include: { portas: { orderBy: { portaNum: "asc" } } } } } },
      equipamentos: { orderBy: [{ ordemGlobal: "asc" }], include: { portas: { orderBy: { portaNum: "asc" } } } },
      linksInternet: { include: { operadora: true }, orderBy: [{ ordemExportacao: "asc" }, { nomeLink: "asc" }] },
      interfaces: { orderBy: [{ ordem: "asc" }, { nome: "asc" }] },
      patchPanels: { orderBy: [{ rackNum: "asc" }, { nome: "asc" }], include: { portas: { orderBy: { portaNum: "asc" } } } },
      telefonia: { include: { ramais: { orderBy: { ramal: "asc" } } } }
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
  escopoDhcp: z.enum(["DHCP", "IP_FIXO", "DHCP_RELAY"]).default("DHCP"),
  dhcpInicio: z.string().min(1).nullable().optional(),
  dhcpFim: z.string().min(1).nullable().optional(),
  gateway: z.string().min(1),
  tipoAcessoInternet: z.string().min(1),
  ativo: z.boolean().default(true)
});

app.post("/api/sites/:siteId/vlans", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const input = normalizeDhcpRange(vlanManualSchema.parse(req.body));
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
      escopoDhcp: item.escopoDhcp,
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
  const before = await prisma.vlan.findUniqueOrThrow({ where: { id: req.params.vlanId } });
  const parsed = vlanManualSchema.partial().parse(req.body);
  const dhcp = normalizeDhcpRange({
    escopoDhcp: parsed.escopoDhcp ?? before.escopoDhcp,
    dhcpInicio: parsed.dhcpInicio !== undefined ? parsed.dhcpInicio : before.dhcpInicio,
    dhcpFim: parsed.dhcpFim !== undefined ? parsed.dhcpFim : before.dhcpFim
  });
  const input = { ...parsed, ...dhcp };
  const after = await prisma.vlan.update({ where: { id: req.params.vlanId }, data: input });
  await audit(req, "vlans", after.id, "UPDATE", before, after, req.body.motivo);
  res.json(after);
}));

app.delete("/api/vlans/:vlanId", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const before = await prisma.vlan.findUniqueOrThrow({ where: { id: req.params.vlanId } });
  await prisma.vlan.delete({ where: { id: req.params.vlanId } });
  await audit(req, "vlans", before.id, "DELETE", before, null, req.body?.motivo);
  res.json({ ok: true });
}));

const rackSchema = z.object({
  rackNum: z.number().int().positive(),
  localRack: z.string().min(1),
  qtdSwitches: z.number().int().positive(),
  alturaU: z.number().int().positive().optional().nullable(),
  labelExport: z.string().optional().nullable(),
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
  await prisma.equipamento.delete({ where: { id: req.params.equipamentoId } });
  await audit(req, "equipamentos", before.id, "DELETE", before, null);
  res.json({ ok: true });
}));

app.get("/api/templates/vlans", asyncHandler(async (_req, res) => {
  res.json(await prisma.templateVlan.findMany({ orderBy: [{ dblabel: "asc" }, { vlanId: "asc" }] }));
}));

const templateVlanBaseSchema = z.object({
  dblabel: z.string().min(1),
  vlanId: z.number().int().positive(),
  vlanNome: z.string().min(1),
  baseOcteto: z.number().int().min(0).max(255),
  escopoDhcp: z.enum(["DHCP", "IP_FIXO", "DHCP_RELAY"]).default("DHCP"),
  dhcpInicio: z.number().int().min(1).max(254).nullable().optional(),
  dhcpFim: z.number().int().min(1).max(254).nullable().optional(),
  tipoAcessoInternet: z.string().min(1),
  gatewayTemplate: z.number().int().min(1).max(254),
  ativo: z.boolean().default(true)
});

app.post("/api/templates/vlans", requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const template = await prisma.templateVlan.create({ data: normalizeDhcpRange(templateVlanBaseSchema.parse(req.body)) });
  await audit(req, "template_vlans", template.id, "CREATE", null, template);
  res.status(201).json(template);
}));

app.put("/api/templates/vlans/:templateId", requireRole("ADMIN"), asyncHandler(async (req, res) => {
  const before = await prisma.templateVlan.findUniqueOrThrow({ where: { id: req.params.templateId } });
  const parsed = templateVlanBaseSchema.partial().parse(req.body);
  const dhcp = normalizeDhcpRange({
    escopoDhcp: parsed.escopoDhcp ?? before.escopoDhcp,
    dhcpInicio: parsed.dhcpInicio !== undefined ? parsed.dhcpInicio : before.dhcpInicio,
    dhcpFim: parsed.dhcpFim !== undefined ? parsed.dhcpFim : before.dhcpFim
  });
  const input = { ...parsed, ...dhcp };
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
    redeOperadora: z.string().optional().nullable(),
    ipMikrotik: z.string().optional().nullable(),
    ipOperadora: z.string().optional().nullable(),
    velocidade: z.string().optional().nullable(),
    interfaceNome: z.string().optional().nullable(),
    ordemExportacao: z.number().int().positive().optional().nullable(),
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

const switchPortSchema = z.object({
  equipamentoId: z.string().uuid(),
  vlanId: z.string().uuid().optional().nullable(),
  portaNum: z.number().int().positive(),
  descricao: z.string().optional().nullable(),
  status: z.enum(["UP", "DOWN", "PRV", "VAGO"]).default("VAGO"),
  observacao: z.string().optional().nullable(),
  ordem: z.number().int().positive().optional().nullable()
});

app.get("/api/sites/:siteId/switch-ports", asyncHandler(async (req, res) => {
  const ports = await prisma.switchPort.findMany({
    where: { equipamento: { siteId: req.params.siteId } },
    include: { equipamento: true, vlan: true },
    orderBy: [{ equipamento: { ordemGlobal: "asc" } }, { portaNum: "asc" }]
  });
  res.json(ports);
}));

app.post("/api/equipamentos/:equipamentoId/ports/template", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const schema = z.object({ quantidade: z.number().int().min(1).max(48).default(28) });
  const { quantidade } = schema.parse(req.body ?? {});
  const equipamento = await prisma.equipamento.findUniqueOrThrow({ where: { id: req.params.equipamentoId } });
  const data = Array.from({ length: quantidade }, (_, index) => ({
    equipamentoId: equipamento.id,
    portaNum: index + 1,
    ordem: index + 1,
    descricao: "VAGO",
    status: "VAGO"
  }));
  const created = await prisma.switchPort.createMany({ data, skipDuplicates: true });
  await audit(req, "switch_ports", equipamento.id, "GENERATE_PORTS", null, data);
  res.status(201).json({ created: created.count });
}));

app.post("/api/switch-ports", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const port = await prisma.switchPort.create({ data: switchPortSchema.parse(req.body) });
  await audit(req, "switch_ports", port.id, "CREATE", null, port);
  res.status(201).json(port);
}));

app.put("/api/switch-ports/:portId", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const before = await prisma.switchPort.findUniqueOrThrow({ where: { id: req.params.portId } });
  const after = await prisma.switchPort.update({ where: { id: req.params.portId }, data: switchPortSchema.partial().parse(req.body) });
  await audit(req, "switch_ports", after.id, "UPDATE", before, after, req.body?.motivo);
  res.json(after);
}));

app.delete("/api/switch-ports/:portId", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const before = await prisma.switchPort.findUniqueOrThrow({ where: { id: req.params.portId } });
  await prisma.switchPort.delete({ where: { id: req.params.portId } });
  await audit(req, "switch_ports", before.id, "DELETE", before, null);
  res.json({ ok: true });
}));

const patchPanelSchema = z.object({
  rackId: z.string().uuid().optional().nullable(),
  nome: z.string().min(1),
  rackNum: z.number().int().positive().optional().nullable(),
  descricao: z.string().optional().nullable(),
  ativo: z.boolean().default(true)
});

const patchPanelPortSchema = z.object({
  switchPortId: z.string().uuid().optional().nullable(),
  portaNum: z.number().int().positive(),
  descricao: z.string().optional().nullable(),
  observacao: z.string().optional().nullable(),
  ativo: z.boolean().default(true)
});

app.post("/api/sites/:siteId/patch-panels", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const panel = await prisma.patchPanel.create({ data: { ...patchPanelSchema.parse(req.body), siteId: req.params.siteId } });
  await audit(req, "patch_panels", panel.id, "CREATE", null, panel);
  res.status(201).json(panel);
}));

app.put("/api/patch-panels/:panelId", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const before = await prisma.patchPanel.findUniqueOrThrow({ where: { id: req.params.panelId } });
  const after = await prisma.patchPanel.update({ where: { id: req.params.panelId }, data: patchPanelSchema.partial().parse(req.body) });
  await audit(req, "patch_panels", after.id, "UPDATE", before, after, req.body?.motivo);
  res.json(after);
}));

app.post("/api/patch-panels/:panelId/ports", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const port = await prisma.patchPanelPort.create({ data: { ...patchPanelPortSchema.parse(req.body), patchPanelId: req.params.panelId } });
  await audit(req, "patch_panel_ports", port.id, "CREATE", null, port);
  res.status(201).json(port);
}));

app.put("/api/patch-panel-ports/:portId", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const before = await prisma.patchPanelPort.findUniqueOrThrow({ where: { id: req.params.portId } });
  const after = await prisma.patchPanelPort.update({ where: { id: req.params.portId }, data: patchPanelPortSchema.partial().parse(req.body) });
  await audit(req, "patch_panel_ports", after.id, "UPDATE", before, after, req.body?.motivo);
  res.json(after);
}));

const siteInterfaceSchema = z.object({
  vlanId: z.string().uuid().optional().nullable(),
  linkInternetId: z.string().uuid().optional().nullable(),
  nome: z.string().min(1),
  descricao: z.string().optional().nullable(),
  ipCidr: z.string().optional().nullable(),
  gateway: z.string().optional().nullable(),
  tipo: z.string().default("MIKROTIK"),
  ordem: z.number().int().positive().optional().nullable(),
  ativo: z.boolean().default(true)
});

app.post("/api/sites/:siteId/interfaces", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const item = await prisma.siteInterface.create({ data: { ...siteInterfaceSchema.parse(req.body), siteId: req.params.siteId } });
  await audit(req, "site_interfaces", item.id, "CREATE", null, item);
  res.status(201).json(item);
}));

app.put("/api/site-interfaces/:interfaceId", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const before = await prisma.siteInterface.findUniqueOrThrow({ where: { id: req.params.interfaceId } });
  const after = await prisma.siteInterface.update({ where: { id: req.params.interfaceId }, data: siteInterfaceSchema.partial().parse(req.body) });
  await audit(req, "site_interfaces", after.id, "UPDATE", before, after, req.body?.motivo);
  res.json(after);
}));

const telefoniaSiteSchema = z.object({
  titulo: z.string().optional().nullable(),
  modelo: z.string().optional().nullable(),
  tipo: z.string().optional().nullable(),
  ip: z.string().optional().nullable(),
  senhaRamais: z.string().optional().nullable(),
  observacao: z.string().optional().nullable()
});

const telefoniaRamalSchema = z.object({
  local: z.string().min(1),
  ramal: z.string().min(1),
  liberacao: z.string().min(1),
  observacao: z.string().optional().nullable(),
  ativo: z.boolean().default(true)
});

app.put("/api/sites/:siteId/telefonia", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const input = telefoniaSiteSchema.parse(req.body);
  const before = await prisma.telefoniaSite.findUnique({ where: { siteId: req.params.siteId } });
  const after = await prisma.telefoniaSite.upsert({
    where: { siteId: req.params.siteId },
    update: input,
    create: { ...input, siteId: req.params.siteId }
  });
  await audit(req, "telefonia_site", after.id, before ? "UPDATE" : "CREATE", before, after);
  res.json(after);
}));

app.post("/api/sites/:siteId/telefonia/ramais", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const telefonia = await prisma.telefoniaSite.upsert({
    where: { siteId: req.params.siteId },
    update: {},
    create: { siteId: req.params.siteId }
  });
  const ramal = await prisma.telefoniaRamal.create({ data: { ...telefoniaRamalSchema.parse(req.body), telefoniaSiteId: telefonia.id } });
  await audit(req, "telefonia_ramais", ramal.id, "CREATE", null, ramal);
  res.status(201).json(ramal);
}));

app.put("/api/telefonia/ramais/:ramalId", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const before = await prisma.telefoniaRamal.findUniqueOrThrow({ where: { id: req.params.ramalId } });
  const after = await prisma.telefoniaRamal.update({ where: { id: req.params.ramalId }, data: telefoniaRamalSchema.partial().parse(req.body) });
  await audit(req, "telefonia_ramais", after.id, "UPDATE", before, after, req.body?.motivo);
  res.json(after);
}));

app.delete("/api/telefonia/ramais/:ramalId", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const before = await prisma.telefoniaRamal.findUniqueOrThrow({ where: { id: req.params.ramalId } });
  await prisma.telefoniaRamal.delete({ where: { id: req.params.ramalId } });
  await audit(req, "telefonia_ramais", before.id, "DELETE", before, null);
  res.json({ ok: true });
}));

const reservaSchema = z.object({
  vlanId: z.string().uuid(),
  ipReservadoPadraoId: z.string().uuid().optional().nullable(),
  tipoReserva: z.enum(["IP_UNICO", "FAIXA", "DHCP"]).default("IP_UNICO"),
  ipReal: z.string().optional().nullable(),
  ipFim: z.string().optional().nullable(),
  mac: z.string().optional().nullable(),
  hostnameEsperado: z.string().optional().nullable(),
  observacao: z.string().optional().nullable()
});

app.get("/api/sites/:siteId/ip-reservados", asyncHandler(async (req, res) => {
  const reservas = await prisma.vlanIpReservado.findMany({
    where: { vlan: { siteId: req.params.siteId } },
    include: { vlan: true, ipReservadoPadrao: true },
    orderBy: [{ vlan: { vlanId: "asc" } }, { hostnameEsperado: "asc" }]
  });
  res.json(reservas);
}));

app.post("/api/sites/:siteId/ip-reservados", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const input = reservaSchema.parse(req.body);
  await assertVlanBelongsToSite(input.vlanId, req.params.siteId);
  const reserva = await prisma.vlanIpReservado.create({ data: input });
  await audit(req, "vlan_ip_reservado", reserva.id, "CREATE", null, reserva);
  res.status(201).json(reserva);
}));

app.put("/api/ip-reservados/:reservaId", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const before = await prisma.vlanIpReservado.findUniqueOrThrow({ where: { id: req.params.reservaId } });
  const after = await prisma.vlanIpReservado.update({ where: { id: req.params.reservaId }, data: reservaSchema.partial().parse(req.body) });
  await audit(req, "vlan_ip_reservado", after.id, "UPDATE", before, after, req.body?.motivo);
  res.json(after);
}));

app.delete("/api/ip-reservados/:reservaId", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const before = await prisma.vlanIpReservado.findUniqueOrThrow({ where: { id: req.params.reservaId } });
  await prisma.vlanIpReservado.delete({ where: { id: req.params.reservaId } });
  await audit(req, "vlan_ip_reservado", before.id, "DELETE", before, null);
  res.json({ ok: true });
}));

app.get("/api/sites/:siteId/export/documentacao-xlsx", asyncHandler(async (req, res) => {
  const site = await loadFullSite(req.params.siteId);
  const workbook = await loadTemplateWorkbook();
  const buffer = patchWorkbook(workbook, buildDocumentationPatches(site));
  await audit(req, "sites", site.id, "EXPORT_XLSX", null, { file: `DOCUMENTACAO-SIDOR-${site.codigoSite}.xlsx` });
  res.setHeader("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("content-disposition", `attachment; filename="DOCUMENTACAO-SIDOR-${sanitizeFilename(site.codigoSite)}.xlsx"`);
  res.send(buffer);
}));

const importSchema = z.object({
  fileBase64: z.string().optional(),
  allowMerge: z.boolean().default(false)
});

app.post("/api/sites/:siteId/import-xlsx/preview", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const input = importSchema.partial().parse(req.body ?? {});
  const workbook = input.fileBase64 ? loadWorkbookFromBuffer(Buffer.from(input.fileBase64, "base64")) : await loadTemplateWorkbook();
  const parsed = parseDocumentationWorkbook(workbook);
  const conflicts = await importConflicts(req.params.siteId);
  res.json({ ...parsed.summary, conflicts });
}));

app.post("/api/sites/:siteId/import-xlsx/confirm", requireRole("ADMIN", "OPERADOR"), asyncHandler(async (req, res) => {
  const input = importSchema.parse(req.body ?? {});
  const workbook = input.fileBase64 ? loadWorkbookFromBuffer(Buffer.from(input.fileBase64, "base64")) : await loadTemplateWorkbook();
  const parsed = parseDocumentationWorkbook(workbook);
  const conflicts = await importConflicts(req.params.siteId);
  if (!input.allowMerge && conflicts.some((item) => item.count > 0)) {
    return res.status(409).json({ error: "Importação bloqueada: site já possui dados estruturados", conflicts });
  }
  const result = await importDocumentation(req.params.siteId, parsed);
  await audit(req, "sites", req.params.siteId, "IMPORT_XLSX", null, result);
  res.status(201).json(result);
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
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
    return res.status(409).json({ error: "Registro possui vínculos e não pode ser excluído", meta: error.meta });
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
  return generateVlans(site.vlan1Cidr, templates.map((template) => ({
    id: template.id,
    dblabel: template.dblabel,
    vlanId: template.vlanId,
    vlanNome: template.vlanNome,
    baseOcteto: template.baseOcteto,
    escopoDhcp: template.escopoDhcp === "IP_FIXO" || template.escopoDhcp === "DHCP_RELAY" ? template.escopoDhcp : "DHCP",
    dhcpInicio: template.dhcpInicio,
    dhcpFim: template.dhcpFim,
    tipoAcessoInternet: template.tipoAcessoInternet,
    gatewayTemplate: template.gatewayTemplate,
    ativo: template.ativo
  }))).map((item) => ({
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

async function assertVlanBelongsToSite(vlanId: string, siteId: string) {
  await prisma.vlan.findFirstOrThrow({ where: { id: vlanId, siteId } });
}

async function loadFullSite(siteId: string) {
  return prisma.site.findUniqueOrThrow({
    where: { id: siteId },
    include: {
      vlans: { orderBy: { vlanId: "asc" }, include: { reservas: { orderBy: { hostnameEsperado: "asc" } }, acessosInternet: true } },
      racks: { orderBy: { rackNum: "asc" } },
      equipamentos: { orderBy: { ordemGlobal: "asc" }, include: { portas: { orderBy: { portaNum: "asc" }, include: { vlan: true } } } },
      linksInternet: { include: { operadora: true }, orderBy: [{ ordemExportacao: "asc" }, { nomeLink: "asc" }] },
      interfaces: { orderBy: [{ ordem: "asc" }, { nome: "asc" }] },
      patchPanels: { orderBy: [{ rackNum: "asc" }, { nome: "asc" }], include: { portas: { orderBy: { portaNum: "asc" } } } },
      telefonia: { include: { ramais: { orderBy: { ramal: "asc" } } } }
    }
  });
}

function buildDocumentationPatches(site: Awaited<ReturnType<typeof loadFullSite>>) {
  const patches = new Map<string, Record<string, string | number | null>>();
  const redes: Record<string, string | number | null> = {};
  const base: Record<string, string | number | null> = {};
  const sw: Record<string, string | number | null> = {};
  const patch: Record<string, string | number | null> = {};
  const telefonia: Record<string, string | number | null> = {};

  site.vlans.slice(0, 19).forEach((vlan, index) => {
    const row = 3 + index;
    const dhcpRow = 25 + index;
    const accessRow = 47 + index;
    redes[`A${row}`] = vlan.vlanId;
    redes[`B${row}`] = vlan.vlanNome;
    redes[`C${row}`] = vlan.redeCidr;
    redes[`D${row}`] = `vlan${vlan.vlanId}`;
    redes[`F${row}`] = vlan.ativo ? "Ativo" : "Desativado";
    redes[`A${dhcpRow}`] = vlan.vlanId;
    redes[`B${dhcpRow}`] = vlan.vlanNome;
    redes[`C${dhcpRow}`] = vlan.escopoDhcp === "DHCP" ? vlan.dhcpInicio : formatScopeForExcel(vlan.escopoDhcp);
    redes[`D${dhcpRow}`] = vlan.escopoDhcp === "DHCP" ? vlan.dhcpFim : null;
    redes[`E${dhcpRow}`] = vlan.ativo ? "Ativo" : "Desativado";
    redes[`A${accessRow}`] = vlan.vlanId;
    redes[`B${accessRow}`] = vlan.vlanNome;
    redes[`C${accessRow}`] = vlan.redeCidr;
    redes[`D${accessRow}`] = vlan.tipoAcessoInternet;
    redes[`E${accessRow}`] = vlan.ativo ? "Ativo" : "Desativado";
  });

  const basePrefix = site.vlan1Cidr.replace(/0\/24$/, "");
  const ipOffsets = [241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239];
  ipOffsets.forEach((offset, index) => {
    const row = 3 + index;
    base[`C${row}`] = basePrefix;
    base[`D${row}`] = offset;
  });

  site.equipamentos.slice(0, 20).forEach((equipment, index) => {
    const row = 47 + index;
    redes[`H${row}`] = equipment.hostname;
    redes[`I${row}`] = equipment.ipGerenciamento;
    redes[`J${row}`] = equipment.localRack;
  });

  const reservas = site.vlans.flatMap((vlan) => vlan.reservas.map((reserva) => ({ vlan, reserva }))).slice(0, 85);
  reservas.forEach(({ reserva }, index) => {
    const row = 3 + index;
    redes[`N${row}`] = reserva.hostnameEsperado ?? reserva.observacao ?? "Reservado";
    redes[`O${row}`] = reserva.tipoReserva === "DHCP" ? "DHCP" : reserva.ipFim ? `${reserva.ipReal ?? ""} - ${reserva.ipFim}` : reserva.ipReal;
    redes[`P${row}`] = reserva.mac ?? null;
  });

  site.linksInternet.slice(0, 8).forEach((link, index) => {
    const row = 61 + index;
    redes[`H${row}`] = link.redeOperadora ?? link.mascaraOuCidr ?? link.nomeLink;
    redes[`I${row}`] = link.ipMikrotik ?? link.ipWan ?? null;
    redes[`J${row}`] = link.ipOperadora ?? link.gatewayWan ?? null;
    redes[`L${row}`] = link.velocidade ?? null;
  });

  const switchBlocks = [
    { title: "A3", port: "B", desc: "C", status: "D", vlan: "E", rack: "A2" },
    { title: "G3", port: "H", desc: "I", status: "J", vlan: "K", rack: "A2" },
    { title: "M3", port: "N", desc: "O", status: "P", vlan: "Q", rack: "A2" },
    { title: "S3", port: "T", desc: "U", status: "V", vlan: "W", rack: "A2" },
    { title: "Y3", port: "Z", desc: "AA", status: "AB", vlan: "AC", rack: "A2" },
    { title: "AE3", port: "AF", desc: "AG", status: "AH", vlan: "AI", rack: "AE2" },
    { title: "AK3", port: "AL", desc: "AM", status: "AN", vlan: "AO", rack: "AE2" },
    { title: "AQ3", port: "AR", desc: "AS", status: "AT", vlan: "AU", rack: "AE2" },
    { title: "AW3", port: "AX", desc: "AY", status: "AZ", vlan: "BA", rack: "AE2" },
    { title: "BC3", port: "BD", desc: "BE", status: "BF", vlan: "BG", rack: "BC2" },
    { title: "BI3", port: "BJ", desc: "BK", status: "BL", vlan: "BM", rack: "BI2" }
  ];
  site.racks.slice(0, 4).forEach((rack, index) => {
    const rackCell = ["A2", "AE2", "BC2", "BI2"][index];
    sw[rackCell] = rack.labelExport ?? `RACK ${rack.rackNum}${rack.alturaU ? ` - ${rack.alturaU}U` : ""} - ${rack.localRack}`;
    patch[rackCell === "A2" ? "A2" : rackCell === "AE2" ? "Q2" : rackCell === "BC2" ? "AG2" : "AK2"] = sw[rackCell];
  });
  site.equipamentos.slice(0, switchBlocks.length).forEach((equipment, index) => {
    const block = switchBlocks[index];
    sw[block.title] = `${equipment.papelSwitch === "CORE" ? "SWITCH CORE" : "SWITCH"} - ${equipment.ipGerenciamento}`;
    equipment.portas.slice(0, 28).forEach((port, portIndex) => {
      const row = 4 + portIndex;
      sw[`${block.port}${row}`] = port.portaNum;
      sw[`${block.desc}${row}`] = port.descricao ?? "VAGO";
      sw[`${block.status}${row}`] = port.status;
      sw[`${block.vlan}${row}`] = port.vlan?.vlanId ?? null;
    });
  });

  site.patchPanels.slice(0, 10).forEach((panel, panelIndex) => {
    const titleCells = ["A3", "E3", "I3", "M3", "Q3", "U3", "Y3", "AC3", "AG3", "AK3"];
    const portColumns = ["B", "F", "J", "N", "R", "V", "Z", "AD", "AH", "AL"];
    const descColumns = ["C", "G", "K", "O", "S", "W", "AA", "AE", "AI", "AM"];
    patch[titleCells[panelIndex]] = panel.nome;
    panel.portas.slice(0, 24).forEach((port, index) => {
      const row = 4 + index;
      patch[`${portColumns[panelIndex]}${row}`] = port.portaNum;
      patch[`${descColumns[panelIndex]}${row}`] = port.descricao ?? "VAGO";
    });
  });

  const tel = site.telefonia;
  if (tel) {
    telefonia.A1 = tel.titulo ?? `TELEFONES ${site.labelSite}`;
    telefonia.F1 = tel.modelo ?? null;
    telefonia.F2 = tel.tipo ?? null;
    telefonia.F3 = tel.ip ?? null;
    telefonia.F4 = tel.senhaRamais ?? null;
    tel.ramais.slice(0, 20).forEach((ramal, index) => {
      const row = 3 + index;
      telefonia[`A${row}`] = ramal.local;
      telefonia[`B${row}`] = ramal.ramal;
      telefonia[`C${row}`] = ramal.liberacao;
    });
  }

  patches.set("Redes", redes);
  patches.set("Base", base);
  patches.set("SWITCH", sw);
  patches.set("PATCH-PANEL", patch);
  patches.set("Telefonia", telefonia);
  return patches;
}

type ParsedDocumentation = ReturnType<typeof parseDocumentationWorkbook>;

function parseDocumentationWorkbook(workbook: Awaited<ReturnType<typeof loadTemplateWorkbook>>) {
  const redes = readSheetCells(workbook, "Redes");
  const sw = readSheetCells(workbook, "SWITCH");
  const tel = readSheetCells(workbook, "Telefonia");
  const vlans: Array<{
    vlanId: number;
    vlanNome: string;
    redeCidr: string;
    gateway: string;
    escopoDhcp: "DHCP" | "IP_FIXO" | "DHCP_RELAY";
    dhcpInicio: string | null;
    dhcpFim: string | null;
    tipoAcessoInternet: string;
    ativo: boolean;
  }> = [];
  for (let row = 3; row <= 21; row += 1) {
    const vlanId = numberCell(redes, `A${row}`);
    const vlanNome = cell(redes, `B${row}`);
    const redeCidr = cell(redes, `C${row}`);
    if (!vlanId || !vlanNome || !redeCidr || redeCidr.includes("-")) continue;
    const dhcpRow = 24 + vlanId;
    const scopeValue = cell(redes, `C${dhcpRow}`);
    vlans.push({
      vlanId,
      vlanNome,
      redeCidr,
      gateway: cidrHost(redeCidr, 254),
      escopoDhcp: scopeValue === "IP FIXO" ? "IP_FIXO" : scopeValue === "DHCP RELAY" ? "DHCP_RELAY" : "DHCP",
      dhcpInicio: scopeValue && scopeValue.includes(".") ? scopeValue : null,
      dhcpFim: cell(redes, `D${dhcpRow}`) || null,
      tipoAcessoInternet: cell(redes, `D${46 + vlanId}`) || "SEM ACESSO",
      ativo: cell(redes, `F${row}`) !== "Desativado"
    });
  }

  const equipamentos: Array<{
    hostname: string;
    ipGerenciamento: string;
    localRack: string;
    rackNum: number;
    ordemNoRack: number;
    ordemGlobal: number;
    papelSwitch: string;
  }> = [];
  for (let row = 47; row <= 58; row += 1) {
    const hostname = cell(redes, `H${row}`);
    const ipGerenciamento = cell(redes, `I${row}`);
    if (!hostname || !ipGerenciamento) continue;
    const rackNum = Number(hostname.match(/^R(\d+)/)?.[1] ?? 1);
    equipamentos.push({
      hostname,
      ipGerenciamento,
      localRack: cell(redes, `J${row}`) || `Rack ${rackNum}`,
      rackNum,
      ordemNoRack: 1,
      ordemGlobal: equipamentos.length + 1,
      papelSwitch: hostname === "R1SWCORE" ? "CORE" : "ACCESS"
    });
  }

  const blocks = [
    { port: "B", desc: "C", status: "D", vlan: "E" },
    { port: "H", desc: "I", status: "J", vlan: "K" },
    { port: "N", desc: "O", status: "P", vlan: "Q" },
    { port: "T", desc: "U", status: "V", vlan: "W" },
    { port: "Z", desc: "AA", status: "AB", vlan: "AC" },
    { port: "AF", desc: "AG", status: "AH", vlan: "AI" },
    { port: "AL", desc: "AM", status: "AN", vlan: "AO" },
    { port: "AR", desc: "AS", status: "AT", vlan: "AU" },
    { port: "AX", desc: "AY", status: "AZ", vlan: "BA" },
    { port: "BD", desc: "BE", status: "BF", vlan: "BG" },
    { port: "BJ", desc: "BK", status: "BL", vlan: "BM" }
  ];
  const ports: Array<{
    equipmentIndex: number;
    portaNum: number;
    descricao: string;
    status: string;
    vlanId: number;
  }> = [];
  blocks.forEach((block, equipmentIndex) => {
    for (let row = 4; row <= 31; row += 1) {
      const portaNum = numberCell(sw, `${block.port}${row}`);
      const descricao = cell(sw, `${block.desc}${row}`);
      if (!portaNum || !descricao) continue;
      ports.push({
        equipmentIndex,
        portaNum,
        descricao,
        status: normalizePortStatus(cell(sw, `${block.status}${row}`), descricao),
        vlanId: numberCell(sw, `${block.vlan}${row}`)
      });
    }
  });

  const reservas: Array<ReturnType<typeof parseReservation>> = [];
  for (let row = 3; row <= 87; row += 1) {
    const hostnameEsperado = cell(redes, `N${row}`);
    const ip = cell(redes, `O${row}`);
    if (!hostnameEsperado || !ip) continue;
    reservas.push(parseReservation(hostnameEsperado, ip, cell(redes, `P${row}`), vlans));
  }

  const ramais: Array<{ local: string; ramal: string; liberacao: string }> = [];
  for (let row = 3; row <= 22; row += 1) {
    const ramal = cell(tel, `B${row}`);
    if (!ramal) continue;
    ramais.push({ local: cell(tel, `A${row}`) || "-", ramal, liberacao: cell(tel, `C${row}`) || "-" });
  }

  const links: Array<{ redeOperadora: string; ipMikrotik: string; ipOperadora: string; velocidade: string; ordemExportacao: number }> = [];
  for (let row = 61; row <= 63; row += 1) {
    const redeOperadora = cell(redes, `H${row}`);
    if (!redeOperadora) continue;
    links.push({ redeOperadora, ipMikrotik: cell(redes, `I${row}`), ipOperadora: cell(redes, `J${row}`), velocidade: cell(redes, `L${row}`), ordemExportacao: row - 60 });
  }

  const telefonia = {
    titulo: cell(tel, "A1"),
    modelo: cell(tel, "F1"),
    tipo: cell(tel, "F2"),
    ip: cell(tel, "F3"),
    senhaRamais: cell(tel, "F4"),
    ramais
  };

  return {
    vlans,
    equipamentos,
    ports,
    reservas,
    telefonia,
    links,
    summary: {
      sheets: [...workbook.sheets.keys()],
      vlans: vlans.length,
      equipamentos: equipamentos.length,
      portas: ports.length,
      reservas: reservas.length,
      ramais: ramais.length,
      links: links.length
    }
  };
}

async function importConflicts(siteId: string) {
  const [vlans, racks, equipamentos, reservas, ports, telefonia, links] = await Promise.all([
    prisma.vlan.count({ where: { siteId } }),
    prisma.siteRack.count({ where: { siteId } }),
    prisma.equipamento.count({ where: { siteId } }),
    prisma.vlanIpReservado.count({ where: { vlan: { siteId } } }),
    prisma.switchPort.count({ where: { equipamento: { siteId } } }),
    prisma.telefoniaSite.count({ where: { siteId } }),
    prisma.linkInternet.count({ where: { siteId } })
  ]);
  return [
    { entidade: "vlans", count: vlans },
    { entidade: "site_racks", count: racks },
    { entidade: "equipamentos", count: equipamentos },
    { entidade: "vlan_ip_reservado", count: reservas },
    { entidade: "switch_ports", count: ports },
    { entidade: "telefonia_site", count: telefonia },
    { entidade: "links_internet", count: links }
  ];
}

async function importDocumentation(siteId: string, parsed: ParsedDocumentation) {
  return prisma.$transaction(async (tx) => {
    const vlans = await Promise.all(parsed.vlans.map((vlan) => tx.vlan.upsert({
      where: { siteId_vlanId: { siteId, vlanId: vlan.vlanId } },
      update: vlan,
      create: { ...vlan, siteId }
    })));
    const vlanById = new Map(vlans.map((vlan) => [vlan.vlanId, vlan]));
    const equipmentGroups = new Map<number, typeof parsed.equipamentos>();
    for (const equipment of parsed.equipamentos) {
      equipmentGroups.set(equipment.rackNum, [...(equipmentGroups.get(equipment.rackNum) ?? []), equipment]);
    }
    const rackByNum = new Map<number, { id: string; localRack: string; rackNum: number }>();
    for (const [rackNum, items] of equipmentGroups) {
      const rack = await tx.siteRack.upsert({
        where: { siteId_rackNum: { siteId, rackNum } },
        update: { localRack: items[0]?.localRack ?? `Rack ${rackNum}`, qtdSwitches: items.length },
        create: { siteId, rackNum, localRack: items[0]?.localRack ?? `Rack ${rackNum}`, qtdSwitches: items.length }
      });
      rackByNum.set(rackNum, rack);
    }
    const equipmentRecords: Array<{ id: string; rackNum: number }> = [];
    for (const equipment of parsed.equipamentos) {
      const rack = rackByNum.get(equipment.rackNum);
      if (!rack) continue;
      const ordemNoRack = equipmentRecords.filter((item) => item.rackNum === equipment.rackNum).length + 1;
      const record = await tx.equipamento.upsert({
        where: { siteId_hostname: { siteId, hostname: equipment.hostname } },
        update: { ...equipment, ordemNoRack, rackId: rack.id, localRack: rack.localRack, tipoEquipamento: "SWITCH", ativo: true },
        create: { ...equipment, ordemNoRack, siteId, rackId: rack.id, localRack: rack.localRack, tipoEquipamento: "SWITCH", ativo: true }
      });
      equipmentRecords.push(record);
    }
    let portas = 0;
    for (const port of parsed.ports) {
      const equipment = equipmentRecords[port.equipmentIndex];
      if (!equipment) continue;
      await tx.switchPort.upsert({
        where: { equipamentoId_portaNum: { equipamentoId: equipment.id, portaNum: port.portaNum } },
        update: { descricao: port.descricao, status: port.status, vlanId: port.vlanId ? vlanById.get(port.vlanId)?.id : undefined, ordem: port.portaNum },
        create: { equipamentoId: equipment.id, portaNum: port.portaNum, descricao: port.descricao, status: port.status, vlanId: port.vlanId ? vlanById.get(port.vlanId)?.id : undefined, ordem: port.portaNum }
      });
      portas += 1;
    }
    let reservas = 0;
    for (const reserva of parsed.reservas) {
      const vlan = reserva.vlanId ? vlanById.get(reserva.vlanId) : vlans[0];
      if (!vlan) continue;
      await tx.vlanIpReservado.create({ data: { ...reserva, vlanId: vlan.id } });
      reservas += 1;
    }
    const telefonia = await tx.telefoniaSite.upsert({
      where: { siteId },
      update: { titulo: parsed.telefonia.titulo, modelo: parsed.telefonia.modelo, tipo: parsed.telefonia.tipo, ip: parsed.telefonia.ip, senhaRamais: parsed.telefonia.senhaRamais },
      create: { siteId, titulo: parsed.telefonia.titulo, modelo: parsed.telefonia.modelo, tipo: parsed.telefonia.tipo, ip: parsed.telefonia.ip, senhaRamais: parsed.telefonia.senhaRamais }
    });
    await tx.telefoniaRamal.createMany({
      data: parsed.telefonia.ramais.map((ramal) => ({ ...ramal, telefoniaSiteId: telefonia.id })),
      skipDuplicates: true
    });
    await tx.linkInternet.createMany({
      data: parsed.links.map((link) => ({ ...link, siteId, nomeLink: link.redeOperadora, tipo: "WAN", ativo: true })),
      skipDuplicates: true
    });
    return { vlans: vlans.length, racks: rackByNum.size, equipamentos: equipmentRecords.length, portas, reservas, ramais: parsed.telefonia.ramais.length, links: parsed.links.length };
  });
}

function cell(cells: Map<string, string>, ref: string) {
  return (cells.get(ref) ?? "").trim();
}

function numberCell(cells: Map<string, string>, ref: string) {
  const value = Number(cell(cells, ref).replace(",", "."));
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function cidrHost(cidr: string, host: number) {
  const parsed = parseIpv4Cidr(cidr);
  return `${parsed.first}.${parsed.second}.${parsed.third}.${host}`;
}

function formatScopeForExcel(scope: string) {
  if (scope === "IP_FIXO") return "IP FIXO";
  if (scope === "DHCP_RELAY") return "DHCP RELAY";
  return "DHCP";
}

function normalizePortStatus(status: string, descricao: string) {
  const normalized = status.toUpperCase();
  if (normalized === "UP" || normalized === "DOWN" || normalized === "PRV" || normalized === "VAGO") return normalized;
  return descricao.toUpperCase().startsWith("VAGO") ? "DOWN" : "UP";
}

function parseReservation(hostnameEsperado: string, ipValue: string, mac: string, vlans: Array<{ vlanId: number; redeCidr: string }>) {
  if (ipValue.toUpperCase() === "DHCP") {
    return { tipoReserva: "DHCP" as const, ipReal: null, ipFim: null, mac: mac || null, hostnameEsperado };
  }
  const rangeMatch = ipValue.match(/^(\d+\.\d+\.\d+\.)(\d+)\s*[–-]\s*(\d+)$/);
  const ipReal = rangeMatch ? `${rangeMatch[1]}${rangeMatch[2]}` : ipValue;
  const ipFim = rangeMatch ? `${rangeMatch[1]}${rangeMatch[3]}` : null;
  const vlan = vlans.find((item) => {
    const parsed = parseIpv4Cidr(item.redeCidr);
    return ipReal.startsWith(`${parsed.first}.${parsed.second}.${parsed.third}.`);
  });
  return { vlanId: vlan?.vlanId, tipoReserva: ipFim ? "FAIXA" as const : "IP_UNICO" as const, ipReal, ipFim, mac: mac || null, hostnameEsperado };
}

function sanitizeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "-");
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

function normalizeDhcpRange<T extends { escopoDhcp: string; dhcpInicio?: unknown; dhcpFim?: unknown }>(input: T): T & { dhcpInicio: unknown | null; dhcpFim: unknown | null } {
  if (input.escopoDhcp !== "DHCP") {
    return { ...input, dhcpInicio: null, dhcpFim: null };
  }
  if (input.dhcpInicio === null || input.dhcpInicio === undefined || input.dhcpFim === null || input.dhcpFim === undefined) {
    throw new DomainError("VLAN com escopo DHCP exige dhcp_inicio e dhcp_fim");
  }
  if (typeof input.dhcpInicio === "number" && typeof input.dhcpFim === "number" && input.dhcpInicio > input.dhcpFim) {
    throw new DomainError("dhcp_inicio deve ser menor ou igual a dhcp_fim");
  }
  return { ...input, dhcpInicio: input.dhcpInicio, dhcpFim: input.dhcpFim };
}
