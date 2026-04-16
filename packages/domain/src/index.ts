export type SwitchRole = "CORE" | "ACCESS";
export type EquipmentType = "SWITCH";
export type DhcpScope = "DHCP" | "IP_FIXO" | "DHCP_RELAY";

export interface SiteInput {
  vlan1Cidr: string;
}

export interface VlanTemplate {
  id?: string;
  dblabel: string;
  vlanId: number;
  vlanNome: string;
  baseOcteto: number;
  escopoDhcp: DhcpScope;
  dhcpInicio: number | null;
  dhcpFim: number | null;
  tipoAcessoInternet: string;
  gatewayTemplate: number;
  ativo: boolean;
}

export interface GeneratedVlan {
  vlanId: number;
  vlanNome: string;
  redeCidr: string;
  escopoDhcp: DhcpScope;
  dhcpInicio: string | null;
  dhcpFim: string | null;
  gateway: string;
  tipoAcessoInternet: string;
}

export interface SwitchSlotTemplate {
  slotNum: number;
  sufixoNormal: string;
  sufixoR1: string;
  papelSwitch: SwitchRole;
  ativo: boolean;
}

export interface ExistingSwitch {
  hostname: string;
  ipGerenciamento: string;
  ordemGlobal: number;
}

export interface GeneratedSwitch {
  hostname: string;
  ipGerenciamento: string;
  rackNum: number;
  ordemNoRack: number;
  ordemGlobal: number;
  papelSwitch: SwitchRole;
  tipoEquipamento: EquipmentType;
}

const IPV4_CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
const MANAGEMENT_OFFSETS = [241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239];

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export function parseIpv4Cidr(cidr: string) {
  const match = cidr.match(IPV4_CIDR);
  if (!match) {
    throw new DomainError(`CIDR invalido: ${cidr}`);
  }

  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  if (octets.some((octet) => octet < 0 || octet > 255) || prefix < 0 || prefix > 32) {
    throw new DomainError(`CIDR invalido: ${cidr}`);
  }
  if (prefix !== 24 || octets[3] !== 0) {
    throw new DomainError("A geracao automatica v1 exige VLAN base no formato /24 com host .0");
  }

  return {
    first: octets[0],
    second: octets[1],
    third: octets[2],
    fourth: octets[3],
    prefix
  };
}

export function buildSiteLabel(regional: string, bandeira: string, loja: string) {
  return [regional, bandeira, loja]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" - ");
}

export function buildSiteCode(regional: string, bandeira: string, loja: string) {
  return [regional, bandeira, loja]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("-");
}

export function managementIpForOrder(vlan1Cidr: string, ordemGlobal: number) {
  if (!Number.isInteger(ordemGlobal) || ordemGlobal < 1) {
    throw new DomainError("ordem_global deve iniciar em 1");
  }
  const offset = MANAGEMENT_OFFSETS[ordemGlobal - 1];
  if (offset === undefined) {
    throw new DomainError("Geracao automatica bloqueada: limite de 20 switches por site atingido");
  }
  const base = parseIpv4Cidr(vlan1Cidr);
  return `${base.first}.${base.second}.${base.third}.${offset}`;
}

export function switchHostname(rackNum: number, ordemNoRack: number, slot?: SwitchSlotTemplate) {
  if (!Number.isInteger(rackNum) || rackNum < 1) {
    throw new DomainError("rack_num deve ser positivo");
  }
  if (!Number.isInteger(ordemNoRack) || ordemNoRack < 1) {
    throw new DomainError("ordem_no_rack deve iniciar em 1");
  }

  if (slot) {
    const suffix = rackNum === 1 ? slot.sufixoR1 : slot.sufixoNormal;
    return `R${rackNum}SW${suffix}`;
  }

  if (rackNum === 1 && ordemNoRack === 1) {
    return "R1SWCORE";
  }

  const letterIndex = rackNum === 1 ? ordemNoRack - 2 : ordemNoRack - 1;
  if (letterIndex > 25) {
    throw new DomainError("Sufixos automaticos sem template suportam no maximo 26 switches por rack");
  }
  return `R${rackNum}SW${String.fromCharCode(65 + letterIndex)}`;
}

export function generateVlans(vlan1Cidr: string, templates: VlanTemplate[]) {
  const base = parseIpv4Cidr(vlan1Cidr);
  return templates
    .filter((template) => template.ativo)
    .sort((a, b) => a.vlanId - b.vlanId)
    .map<GeneratedVlan>((template) => {
      validateHostOffset(template.gatewayTemplate, "gateway_template");
      validateOctetOffset(template.baseOcteto, "base_octeto");
      if (!["DHCP", "IP_FIXO", "DHCP_RELAY"].includes(template.escopoDhcp)) {
        throw new DomainError(`Escopo DHCP invalido no template VLAN ${template.vlanId}`);
      }
      if (template.escopoDhcp === "DHCP") {
        if (template.dhcpInicio === null || template.dhcpFim === null) {
          throw new DomainError(`Template VLAN ${template.vlanId} exige dhcp_inicio e dhcp_fim para escopo DHCP`);
        }
        validateHostOffset(template.dhcpInicio, "dhcp_inicio");
        validateHostOffset(template.dhcpFim, "dhcp_fim");
        if (template.dhcpInicio > template.dhcpFim) {
          throw new DomainError(`Faixa DHCP invalida no template VLAN ${template.vlanId}`);
        }
      }
      const thirdOctet = base.third + template.baseOcteto;
      validateOctet(thirdOctet, "terceiro_octeto_calculado");
      const prefix = `${base.first}.${base.second}.${thirdOctet}`;
      return {
        vlanId: template.vlanId,
        vlanNome: template.vlanNome,
        redeCidr: `${prefix}.0/24`,
        escopoDhcp: template.escopoDhcp,
        dhcpInicio: template.escopoDhcp === "DHCP" ? `${prefix}.${template.dhcpInicio}` : null,
        dhcpFim: template.escopoDhcp === "DHCP" ? `${prefix}.${template.dhcpFim}` : null,
        gateway: `${prefix}.${template.gatewayTemplate}`,
        tipoAcessoInternet: template.tipoAcessoInternet
      };
    });
}

export function generateRackSwitches(params: {
  vlan1Cidr: string;
  rackNum: number;
  qtdSwitches: number;
  existingSwitches: ExistingSwitch[];
  slotTemplates: SwitchSlotTemplate[];
}) {
  const { vlan1Cidr, rackNum, qtdSwitches, existingSwitches } = params;
  if (!Number.isInteger(qtdSwitches) || qtdSwitches < 1) {
    throw new DomainError("qtd_switches deve ser positiva");
  }

  const slots = new Map(
    params.slotTemplates
      .filter((slot) => slot.ativo)
      .map((slot) => [slot.slotNum, slot])
  );
  const maxExistingOrder = existingSwitches.reduce((max, item) => Math.max(max, item.ordemGlobal), 0);
  const generated: GeneratedSwitch[] = [];
  const hostnames = new Set(existingSwitches.map((item) => item.hostname.toUpperCase()));
  const ips = new Set(existingSwitches.map((item) => item.ipGerenciamento));

  for (let ordemNoRack = 1; ordemNoRack <= qtdSwitches; ordemNoRack += 1) {
    const ordemGlobal = maxExistingOrder + ordemNoRack;
    const slot = slots.get(ordemNoRack);
    const hostname = switchHostname(rackNum, ordemNoRack, slot);
    const ipGerenciamento = managementIpForOrder(vlan1Cidr, ordemGlobal);
    if (hostnames.has(hostname.toUpperCase())) {
      throw new DomainError(`Hostname duplicado: ${hostname}`);
    }
    if (ips.has(ipGerenciamento)) {
      throw new DomainError(`IP de gerenciamento duplicado: ${ipGerenciamento}`);
    }
    hostnames.add(hostname.toUpperCase());
    ips.add(ipGerenciamento);
    generated.push({
      hostname,
      ipGerenciamento,
      rackNum,
      ordemNoRack,
      ordemGlobal,
      papelSwitch: slot?.papelSwitch ?? (rackNum === 1 && ordemNoRack === 1 ? "CORE" : "ACCESS"),
      tipoEquipamento: "SWITCH"
    });
  }

  return generated;
}

function validateOctet(value: number, field: string) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new DomainError(`${field} deve estar entre 0 e 255`);
  }
}

function validateOctetOffset(value: number, field: string) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new DomainError(`${field} deve ser um incremento entre 0 e 255`);
  }
}

function validateHostOffset(value: number, field: string) {
  if (!Number.isInteger(value) || value < 1 || value > 254) {
    throw new DomainError(`${field} deve estar entre 1 e 254`);
  }
}
