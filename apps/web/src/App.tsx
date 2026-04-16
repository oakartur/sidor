import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

type Role = "ADMIN" | "OPERADOR" | "LEITURA";
type DhcpScope = "DHCP" | "IP_FIXO" | "DHCP_RELAY";

interface User {
  id: string;
  nome: string;
  email: string;
  role: Role;
}

interface Site {
  id: string;
  codigoSite: string;
  regional: string;
  bandeira: string;
  loja: string;
  labelSite: string;
  vlan1Cidr: string;
  ativo: boolean;
  _count?: {
    vlans: number;
    racks: number;
    equipamentos: number;
    linksInternet: number;
  };
  vlans?: Vlan[];
  racks?: Rack[];
  equipamentos?: Equipamento[];
  linksInternet?: LinkInternet[];
  interfaces?: SiteInterface[];
  patchPanels?: PatchPanel[];
  telefonia?: TelefoniaSite | null;
}

interface Vlan {
  id: string;
  vlanId: number;
  vlanNome: string;
  redeCidr: string;
  gateway: string;
  escopoDhcp: DhcpScope;
  dhcpInicio: string | null;
  dhcpFim: string | null;
  tipoAcessoInternet: string;
  ativo: boolean;
  reservas?: ReservaIp[];
}

interface Rack {
  id: string;
  rackNum: number;
  localRack: string;
  qtdSwitches: number;
  ativo: boolean;
  equipamentos?: Equipamento[];
}

interface Equipamento {
  id: string;
  rackId: string;
  hostname: string;
  ipGerenciamento: string;
  localRack: string;
  rackNum: number;
  ordemNoRack: number;
  ordemGlobal: number;
  papelSwitch: string;
  observacao?: string | null;
  editadoManual?: boolean;
  ativo: boolean;
  portas?: SwitchPort[];
}

interface LinkInternet {
  id: string;
  nomeLink: string;
  tipo: string;
  redeOperadora?: string | null;
  ipMikrotik?: string | null;
  ipOperadora?: string | null;
  velocidade?: string | null;
  interfaceNome?: string | null;
  ativo: boolean;
  operadora?: { nome: string };
}

interface SwitchPort {
  id: string;
  equipamentoId: string;
  vlanId?: string | null;
  portaNum: number;
  descricao?: string | null;
  status: string;
  observacao?: string | null;
  vlan?: Vlan | null;
}

interface PatchPanel {
  id: string;
  rackId?: string | null;
  nome: string;
  rackNum?: number | null;
  descricao?: string | null;
  ativo: boolean;
  portas?: PatchPanelPort[];
}

interface PatchPanelPort {
  id: string;
  portaNum: number;
  descricao?: string | null;
  ativo: boolean;
}

interface SiteInterface {
  id: string;
  nome: string;
  descricao?: string | null;
  ipCidr?: string | null;
  gateway?: string | null;
  tipo: string;
  ordem?: number | null;
  ativo: boolean;
}

interface ReservaIp {
  id: string;
  vlanId: string;
  tipoReserva: "IP_UNICO" | "FAIXA" | "DHCP";
  ipReal?: string | null;
  ipFim?: string | null;
  mac?: string | null;
  hostnameEsperado?: string | null;
  observacao?: string | null;
  vlan?: Vlan;
}

interface TelefoniaSite {
  id: string;
  titulo?: string | null;
  modelo?: string | null;
  tipo?: string | null;
  ip?: string | null;
  senhaRamais?: string | null;
  ramais: TelefoniaRamal[];
}

interface TelefoniaRamal {
  id: string;
  local: string;
  ramal: string;
  liberacao: string;
  ativo: boolean;
}

interface Dashboard {
  sites: number;
  vlans: number;
  racks: number;
  equipamentos: number;
  ultimasAlteracoes: Array<{ id: string; entidade: string; acao: string; createdAt: string }>;
}

interface GeneratedVlan {
  vlanId: number;
  vlanNome: string;
  redeCidr: string;
  escopoDhcp: DhcpScope;
  dhcpInicio: string | null;
  dhcpFim: string | null;
  gateway: string;
  tipoAcessoInternet: string;
  conflict?: boolean;
}

interface VlanTemplate {
  id: string;
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

type VlanTemplateForm = Omit<VlanTemplate, "id">;

interface GeneratedSwitch {
  hostname: string;
  ipGerenciamento: string;
  rackNum: number;
  ordemNoRack: number;
  ordemGlobal: number;
  papelSwitch: string;
  conflict?: boolean;
}

const API_URL = import.meta.env.VITE_API_URL ?? "";

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem("sidor_token") ?? "");
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [siteDetail, setSiteDetail] = useState<Site | null>(null);
  const [activeView, setActiveView] = useState<"operacao" | "templateVlans">("operacao");
  const [activeTab, setActiveTab] = useState("vlans");
  const [search, setSearch] = useState("");
  const [vlanPreview, setVlanPreview] = useState<GeneratedVlan[]>([]);
  const [switchPreview, setSwitchPreview] = useState<GeneratedSwitch[]>([]);
  const [selectedRackId, setSelectedRackId] = useState("");
  const [editingVlanId, setEditingVlanId] = useState("");
  const [vlanForm, setVlanForm] = useState({
    vlanId: 1,
    vlanNome: "",
    redeCidr: "",
    gateway: "",
    escopoDhcp: "DHCP" as DhcpScope,
    dhcpInicio: "",
    dhcpFim: "",
    tipoAcessoInternet: "DIRETO",
    ativo: true
  });
  const [editingEquipmentId, setEditingEquipmentId] = useState("");
  const [equipmentForm, setEquipmentForm] = useState({
    rackId: "",
    hostname: "",
    ipGerenciamento: "",
    localRack: "",
    rackNum: 1,
    ordemNoRack: 1,
    ordemGlobal: 1,
    papelSwitch: "ACCESS",
    observacao: "",
    ativo: true
  });
  const [siteForm, setSiteForm] = useState({
    regional: "",
    bandeira: "",
    loja: "",
    vlan1Cidr: "",
    endereco: ""
  });
  const [rackForm, setRackForm] = useState({ rackNum: 1, localRack: "", qtdSwitches: 1 });
  const [portForm, setPortForm] = useState({ equipamentoId: "", portaNum: 1, descricao: "", status: "UP", vlanId: "" });
  const [patchPanelForm, setPatchPanelForm] = useState({ rackId: "", nome: "", rackNum: 1, descricao: "" });
  const [reservaForm, setReservaForm] = useState({ vlanId: "", tipoReserva: "IP_UNICO", ipReal: "", ipFim: "", hostnameEsperado: "", mac: "" });
  const [interfaceForm, setInterfaceForm] = useState({ nome: "", descricao: "", ipCidr: "", gateway: "", tipo: "MIKROTIK", ordem: 1 });
  const [linkForm, setLinkForm] = useState({ nomeLink: "", tipo: "WAN", redeOperadora: "", ipMikrotik: "", ipOperadora: "", velocidade: "", interfaceNome: "" });
  const [telefoniaForm, setTelefoniaForm] = useState({ titulo: "", modelo: "", tipo: "PBX IP", ip: "", senhaRamais: "" });
  const [ramalForm, setRamalForm] = useState({ local: "", ramal: "", liberacao: "RAMAL/LOCAL" });
  const [vlanTemplates, setVlanTemplates] = useState<VlanTemplate[]>([]);
  const [editingTemplateId, setEditingTemplateId] = useState("");
  const [templateForm, setTemplateForm] = useState<VlanTemplateForm>({
    dblabel: "PADRAO",
    vlanId: 1,
    vlanNome: "",
    baseOcteto: 0,
    escopoDhcp: "DHCP",
    dhcpInicio: 20,
    dhcpFim: 220,
    gatewayTemplate: 1,
    tipoAcessoInternet: "DIRETO",
    ativo: true
  });

  const canWrite = user?.role === "ADMIN" || user?.role === "OPERADOR";
  const canAdmin = user?.role === "ADMIN";
  const vlanPreviewHasConflicts = vlanPreview.some((vlan) => vlan.conflict);
  const derivedSiteCode = useMemo(
    () => [siteForm.regional, siteForm.bandeira, siteForm.loja].map((part) => part.trim()).filter(Boolean).join("-"),
    [siteForm.regional, siteForm.bandeira, siteForm.loja]
  );
  const selectedRack = useMemo(
    () => siteDetail?.racks?.find((rack) => rack.id === selectedRackId),
    [siteDetail?.racks, selectedRackId]
  );

  useEffect(() => {
    if (!token) return;
    localStorage.setItem("sidor_token", token);
    void bootstrap();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const handle = setTimeout(() => void loadSites(), 250);
    return () => clearTimeout(handle);
  }, [search, token]);

  useEffect(() => {
    if (!selectedSiteId || !token) return;
    void loadSiteDetail(selectedSiteId);
  }, [selectedSiteId, token]);

  useEffect(() => {
    if (!token || activeView !== "templateVlans") return;
    void loadVlanTemplates();
  }, [activeView, token]);

  async function bootstrap() {
    try {
      setError("");
      const [me, dash, siteList] = await Promise.all([
        api<User>("/api/auth/me"),
        api<Dashboard>("/api/dashboard"),
        api<Site[]>("/api/sites")
      ]);
      setUser(me);
      setDashboard(dash);
      setSites(siteList);
      if (!selectedSiteId && siteList[0]) setSelectedSiteId(siteList[0].id);
    } catch (err) {
      setError(errorMessage(err));
      setToken("");
      localStorage.removeItem("sidor_token");
    }
  }

  async function loadSites() {
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    setSites(await api<Site[]>(`/api/sites${query}`));
  }

  async function loadSiteDetail(siteId: string) {
    const detail = await api<Site>(`/api/sites/${siteId}`);
    setSiteDetail(detail);
    setPortForm((form) => ({ ...form, equipamentoId: form.equipamentoId || detail.equipamentos?.[0]?.id || "", vlanId: form.vlanId || detail.vlans?.[0]?.id || "" }));
    setPatchPanelForm((form) => ({ ...form, rackId: form.rackId || detail.racks?.[0]?.id || "", rackNum: form.rackNum || detail.racks?.[0]?.rackNum || 1 }));
    setReservaForm((form) => ({ ...form, vlanId: form.vlanId || detail.vlans?.[0]?.id || "" }));
    setTelefoniaForm({
      titulo: detail.telefonia?.titulo ?? "",
      modelo: detail.telefonia?.modelo ?? "",
      tipo: detail.telefonia?.tipo ?? "PBX IP",
      ip: detail.telefonia?.ip ?? "",
      senhaRamais: detail.telefonia?.senhaRamais ?? ""
    });
    setVlanPreview([]);
    setSwitchPreview([]);
  }

  async function login(email: string, password: string) {
    const response = await publicApi<{ token: string; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    setUser(response.user);
    setToken(response.token);
  }

  async function createSite(event: FormEvent) {
    event.preventDefault();
    const created = await api<Site>("/api/sites", { method: "POST", body: JSON.stringify(siteForm) });
    setSiteForm({ regional: "", bandeira: "", loja: "", vlan1Cidr: "", endereco: "" });
    await loadSites();
    setSelectedSiteId(created.id);
  }

  async function loadVlanTemplates() {
    setVlanTemplates(await api<VlanTemplate[]>("/api/templates/vlans"));
  }

  async function saveVlanTemplate(event: FormEvent) {
    event.preventDefault();
    const path = editingTemplateId ? `/api/templates/vlans/${editingTemplateId}` : "/api/templates/vlans";
    await api<VlanTemplate>(path, {
      method: editingTemplateId ? "PUT" : "POST",
      body: JSON.stringify(templateForm)
    });
    resetTemplateForm();
    await loadVlanTemplates();
  }

  function editVlanTemplate(template: VlanTemplate) {
    setEditingTemplateId(template.id);
    setTemplateForm({
      dblabel: template.dblabel,
      vlanId: template.vlanId,
      vlanNome: template.vlanNome,
      baseOcteto: template.baseOcteto,
      escopoDhcp: template.escopoDhcp,
      dhcpInicio: template.dhcpInicio,
      dhcpFim: template.dhcpFim,
      gatewayTemplate: template.gatewayTemplate,
      tipoAcessoInternet: template.tipoAcessoInternet,
      ativo: template.ativo
    });
  }

  function resetTemplateForm() {
    setEditingTemplateId("");
    setTemplateForm({
      dblabel: "PADRAO",
      vlanId: 1,
      vlanNome: "",
      baseOcteto: 0,
      escopoDhcp: "DHCP",
      dhcpInicio: 20,
      dhcpFim: 220,
      gatewayTemplate: 1,
      tipoAcessoInternet: "DIRETO",
      ativo: true
    });
  }

  async function createRack(event: FormEvent) {
    event.preventDefault();
    if (!siteDetail) return;
    setError("");
    const rack = await api<Rack>(`/api/sites/${siteDetail.id}/racks`, {
      method: "POST",
      body: JSON.stringify(rackForm)
    });
    let shouldShowSwitchPreview = false;
    try {
      await api(`/api/racks/${rack.id}/switches/generate`, {
        method: "POST",
        body: JSON.stringify({ confirm: true })
      });
      setSwitchPreview([]);
    } catch (err) {
      setError(`Rack criado, mas a geração automática dos switches falhou: ${errorMessage(err)}`);
      shouldShowSwitchPreview = true;
    }
    setRackForm({ rackNum: rackForm.rackNum + 1, localRack: "", qtdSwitches: 1 });
    setSelectedRackId(rack.id);
    await loadSiteDetail(siteDetail.id);
    if (shouldShowSwitchPreview) {
      await previewSwitches(rack.id);
    }
  }

  async function previewVlans() {
    if (!siteDetail) return;
    setVlanPreview(await api<GeneratedVlan[]>(`/api/sites/${siteDetail.id}/vlans/preview?template=PADRAO`));
  }

  async function generateVlansNow() {
    if (!siteDetail) return;
    await api(`/api/sites/${siteDetail.id}/vlans/generate`, {
      method: "POST",
      body: JSON.stringify({ template: "PADRAO", confirm: true })
    });
    setVlanPreview([]);
    await loadSiteDetail(siteDetail.id);
  }

  async function saveVlanEdit(event: FormEvent) {
    event.preventDefault();
    if (!siteDetail || !editingVlanId) return;
    await api(`/api/vlans/${editingVlanId}`, {
      method: "PUT",
      body: JSON.stringify({
        vlanId: vlanForm.vlanId,
        vlanNome: vlanForm.vlanNome,
        redeCidr: vlanForm.redeCidr,
        gateway: vlanForm.gateway,
        escopoDhcp: vlanForm.escopoDhcp,
        dhcpInicio: vlanForm.escopoDhcp === "DHCP" ? vlanForm.dhcpInicio : null,
        dhcpFim: vlanForm.escopoDhcp === "DHCP" ? vlanForm.dhcpFim : null,
        tipoAcessoInternet: vlanForm.tipoAcessoInternet,
        ativo: vlanForm.ativo
      })
    });
    cancelVlanEdit();
    setVlanPreview([]);
    await loadSiteDetail(siteDetail.id);
  }

  async function deleteVlan(vlan: Vlan) {
    if (!siteDetail) return;
    const confirmed = window.confirm(`Excluir a VLAN ${vlan.vlanId} - ${vlan.vlanNome}?`);
    if (!confirmed) return;
    await api(`/api/vlans/${vlan.id}`, { method: "DELETE" });
    cancelVlanEdit();
    setVlanPreview([]);
    await loadSiteDetail(siteDetail.id);
  }

  function editVlan(vlan: Vlan) {
    setVlanPreview([]);
    setEditingVlanId(vlan.id);
    setVlanForm({
      vlanId: vlan.vlanId,
      vlanNome: vlan.vlanNome,
      redeCidr: vlan.redeCidr,
      gateway: vlan.gateway,
      escopoDhcp: vlan.escopoDhcp,
      dhcpInicio: vlan.dhcpInicio ?? "",
      dhcpFim: vlan.dhcpFim ?? "",
      tipoAcessoInternet: vlan.tipoAcessoInternet,
      ativo: vlan.ativo
    });
  }

  function cancelVlanEdit() {
    setEditingVlanId("");
    setVlanForm({
      vlanId: 1,
      vlanNome: "",
      redeCidr: "",
      gateway: "",
      escopoDhcp: "DHCP",
      dhcpInicio: "",
      dhcpFim: "",
      tipoAcessoInternet: "DIRETO",
      ativo: true
    });
  }

  async function saveEquipmentEdit(event: FormEvent) {
    event.preventDefault();
    if (!siteDetail || !editingEquipmentId) return;
    await api(`/api/equipamentos/${editingEquipmentId}`, {
      method: "PUT",
      body: JSON.stringify({
        rackId: equipmentForm.rackId,
        hostname: equipmentForm.hostname,
        ipGerenciamento: equipmentForm.ipGerenciamento,
        localRack: equipmentForm.localRack,
        rackNum: equipmentForm.rackNum,
        ordemNoRack: equipmentForm.ordemNoRack,
        ordemGlobal: equipmentForm.ordemGlobal,
        papelSwitch: equipmentForm.papelSwitch,
        observacao: equipmentForm.observacao || null,
        ativo: equipmentForm.ativo
      })
    });
    cancelEquipmentEdit();
    setSwitchPreview([]);
    await loadSiteDetail(siteDetail.id);
  }

  async function deleteEquipment(equipment: Equipamento) {
    if (!siteDetail) return;
    const confirmed = window.confirm(`Excluir o equipamento ${equipment.hostname}?`);
    if (!confirmed) return;
    await api(`/api/equipamentos/${equipment.id}`, { method: "DELETE" });
    cancelEquipmentEdit();
    setSwitchPreview([]);
    await loadSiteDetail(siteDetail.id);
  }

  function editEquipment(equipment: Equipamento) {
    setSwitchPreview([]);
    const rack = siteDetail?.racks?.find((item) => item.id === equipment.rackId || item.rackNum === equipment.rackNum);
    setEditingEquipmentId(equipment.id);
    setEquipmentForm({
      rackId: rack?.id ?? equipment.rackId,
      hostname: equipment.hostname,
      ipGerenciamento: equipment.ipGerenciamento,
      localRack: rack?.localRack ?? equipment.localRack,
      rackNum: rack?.rackNum ?? equipment.rackNum,
      ordemNoRack: equipment.ordemNoRack,
      ordemGlobal: equipment.ordemGlobal,
      papelSwitch: equipment.papelSwitch,
      observacao: equipment.observacao ?? "",
      ativo: equipment.ativo
    });
  }

  function cancelEquipmentEdit() {
    setEditingEquipmentId("");
    setEquipmentForm({
      rackId: "",
      hostname: "",
      ipGerenciamento: "",
      localRack: "",
      rackNum: 1,
      ordemNoRack: 1,
      ordemGlobal: 1,
      papelSwitch: "ACCESS",
      observacao: "",
      ativo: true
    });
  }

  async function previewSwitches(rackId = selectedRackId) {
    if (!rackId) return;
    setSwitchPreview(await api<GeneratedSwitch[]>(`/api/racks/${rackId}/switches/preview`));
    setSelectedRackId(rackId);
  }

  async function generateSwitchesNow() {
    if (!selectedRackId || !siteDetail) return;
    await api(`/api/racks/${selectedRackId}/switches/generate`, {
      method: "POST",
      body: JSON.stringify({ confirm: true })
    });
    await loadSiteDetail(siteDetail.id);
  }

  async function exportDocumentation() {
    if (!siteDetail) return;
    const response = await fetch(`${API_URL}/api/sites/${siteDetail.id}/export/documentacao-xlsx`, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error("Falha ao exportar documentação");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `DOCUMENTACAO-SIDOR-${siteDetail.codigoSite}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importDocumentationFile(file: File) {
    if (!siteDetail) return;
    setError("");
    const fileBase64 = arrayBufferToBase64(await file.arrayBuffer());
    const preview = await api<{ vlans: number; equipamentos: number; portas: number; reservas: number; ramais: number; links: number; conflicts: Array<{ entidade: string; count: number }> }>(
      `/api/sites/${siteDetail.id}/import-xlsx/preview`,
      { method: "POST", body: JSON.stringify({ fileBase64 }) }
    );
    const conflicts = preview.conflicts.filter((item) => item.count > 0);
    const message = [
      `Importar ${preview.vlans} VLANs, ${preview.equipamentos} equipamentos, ${preview.portas} portas, ${preview.reservas} IPs reservados, ${preview.ramais} ramais e ${preview.links} links?`,
      conflicts.length ? `Conflitos existentes: ${conflicts.map((item) => `${item.entidade}: ${item.count}`).join(", ")}.` : ""
    ].filter(Boolean).join("\n");
    if (!window.confirm(message)) return;
    await api(`/api/sites/${siteDetail.id}/import-xlsx/confirm`, {
      method: "POST",
      body: JSON.stringify({ fileBase64, allowMerge: false })
    });
    await loadSites();
    await loadSiteDetail(siteDetail.id);
  }

  async function createSwitchPort(event: FormEvent) {
    event.preventDefault();
    if (!siteDetail) return;
    await api("/api/switch-ports", {
      method: "POST",
      body: JSON.stringify({
        equipamentoId: portForm.equipamentoId,
        vlanId: portForm.vlanId || null,
        portaNum: portForm.portaNum,
        descricao: portForm.descricao || null,
        status: portForm.status,
        ordem: portForm.portaNum
      })
    });
    setPortForm({ ...portForm, portaNum: portForm.portaNum + 1, descricao: "" });
    await loadSiteDetail(siteDetail.id);
  }

  async function generatePortTemplate(equipmentId: string) {
    if (!siteDetail) return;
    await api(`/api/equipamentos/${equipmentId}/ports/template`, { method: "POST", body: JSON.stringify({ quantidade: 28 }) });
    await loadSiteDetail(siteDetail.id);
  }

  async function createPatchPanel(event: FormEvent) {
    event.preventDefault();
    if (!siteDetail) return;
    const rack = siteDetail.racks?.find((item) => item.id === patchPanelForm.rackId);
    await api(`/api/sites/${siteDetail.id}/patch-panels`, {
      method: "POST",
      body: JSON.stringify({
        rackId: patchPanelForm.rackId || null,
        nome: patchPanelForm.nome,
        rackNum: rack?.rackNum ?? patchPanelForm.rackNum,
        descricao: patchPanelForm.descricao || null
      })
    });
    setPatchPanelForm({ ...patchPanelForm, nome: "", descricao: "" });
    await loadSiteDetail(siteDetail.id);
  }

  async function createReserva(event: FormEvent) {
    event.preventDefault();
    if (!siteDetail) return;
    await api(`/api/sites/${siteDetail.id}/ip-reservados`, {
      method: "POST",
      body: JSON.stringify({
        vlanId: reservaForm.vlanId,
        tipoReserva: reservaForm.tipoReserva,
        ipReal: reservaForm.tipoReserva === "DHCP" ? null : reservaForm.ipReal,
        ipFim: reservaForm.tipoReserva === "FAIXA" ? reservaForm.ipFim : null,
        hostnameEsperado: reservaForm.hostnameEsperado || null,
        mac: reservaForm.mac || null
      })
    });
    setReservaForm({ ...reservaForm, ipReal: "", ipFim: "", hostnameEsperado: "", mac: "" });
    await loadSiteDetail(siteDetail.id);
  }

  async function createInterface(event: FormEvent) {
    event.preventDefault();
    if (!siteDetail) return;
    await api(`/api/sites/${siteDetail.id}/interfaces`, {
      method: "POST",
      body: JSON.stringify({
        nome: interfaceForm.nome,
        descricao: interfaceForm.descricao || null,
        ipCidr: interfaceForm.ipCidr || null,
        gateway: interfaceForm.gateway || null,
        tipo: interfaceForm.tipo,
        ordem: interfaceForm.ordem
      })
    });
    setInterfaceForm({ nome: "", descricao: "", ipCidr: "", gateway: "", tipo: "MIKROTIK", ordem: interfaceForm.ordem + 1 });
    await loadSiteDetail(siteDetail.id);
  }

  async function createInternetLink(event: FormEvent) {
    event.preventDefault();
    if (!siteDetail) return;
    await api(`/api/sites/${siteDetail.id}/links-internet`, {
      method: "POST",
      body: JSON.stringify({
        nomeLink: linkForm.nomeLink,
        tipo: linkForm.tipo,
        redeOperadora: linkForm.redeOperadora || null,
        ipMikrotik: linkForm.ipMikrotik || null,
        ipOperadora: linkForm.ipOperadora || null,
        velocidade: linkForm.velocidade || null,
        interfaceNome: linkForm.interfaceNome || null
      })
    });
    setLinkForm({ nomeLink: "", tipo: "WAN", redeOperadora: "", ipMikrotik: "", ipOperadora: "", velocidade: "", interfaceNome: "" });
    await loadSiteDetail(siteDetail.id);
  }

  async function saveTelefonia(event: FormEvent) {
    event.preventDefault();
    if (!siteDetail) return;
    await api(`/api/sites/${siteDetail.id}/telefonia`, { method: "PUT", body: JSON.stringify(telefoniaForm) });
    await loadSiteDetail(siteDetail.id);
  }

  async function createRamal(event: FormEvent) {
    event.preventDefault();
    if (!siteDetail) return;
    await api(`/api/sites/${siteDetail.id}/telefonia/ramais`, { method: "POST", body: JSON.stringify(ramalForm) });
    setRamalForm({ local: "", ramal: "", liberacao: "RAMAL/LOCAL" });
    await loadSiteDetail(siteDetail.id);
  }

  async function api<T>(path: string, init?: RequestInit) {
    return publicApi<T>(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...init?.headers
      }
    });
  }

  if (!token || !user) {
    return <LoginView onLogin={login} error={error} />;
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">SIDOR</p>
          <h1>Documentação de rede</h1>
          <p className="muted">Operação de sites, VLANs, racks, switches e links.</p>
        </div>
        <nav className="main-menu">
          <button className={activeView === "operacao" ? "active" : ""} onClick={() => setActiveView("operacao")}>
            Operação
          </button>
          <button className={activeView === "templateVlans" ? "active" : ""} onClick={() => setActiveView("templateVlans")}>
            Templates de VLANs
          </button>
        </nav>
        <label className="search">
          Buscar
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Site, IP ou código" />
        </label>
        <div className="site-list">
          {sites.map((site) => (
            <button
              className={site.id === selectedSiteId ? "site-item active" : "site-item"}
              key={site.id}
              onClick={() => setSelectedSiteId(site.id)}
            >
              <strong>{site.labelSite}</strong>
              <span>{site.codigoSite} - {site.vlan1Cidr}</span>
            </button>
          ))}
        </div>
        <button className="ghost" onClick={() => { setToken(""); localStorage.removeItem("sidor_token"); }}>
          Sair de {user.nome}
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{activeView === "operacao" ? "Painel" : "Administração"}</p>
            <h2>{activeView === "operacao" ? siteDetail?.labelSite ?? "Selecione ou cadastre um site" : "Templates de VLANs"}</h2>
          </div>
          <div className="role">{user.role}</div>
        </header>

        {dashboard && (
          <section className="metrics" aria-label="Resumo operacional">
            <Metric label="Sites" value={dashboard.sites} />
            <Metric label="VLANs" value={dashboard.vlans} />
            <Metric label="Racks" value={dashboard.racks} />
            <Metric label="Switches" value={dashboard.equipamentos} />
          </section>
        )}

        {error && <div className="alert">{error}</div>}

        {activeView === "templateVlans" ? (
          <TemplateVlanManager
            canAdmin={canAdmin}
            editingTemplateId={editingTemplateId}
            form={templateForm}
            onCancel={resetTemplateForm}
            onEdit={editVlanTemplate}
            onSubmit={saveVlanTemplate}
            onUpdateForm={setTemplateForm}
            templates={vlanTemplates}
          />
        ) : (
          <>
        <section className="split">
          <form className="panel" onSubmit={(event) => void createSite(event)}>
            <div className="panel-title">
              <h3>Novo site</h3>
              <p>O código é gerado automaticamente como Regional-Bandeira-Loja. Informe a VLAN 1 base no formato 10.23.160.0/24.</p>
            </div>
            <Field label="Regional">
              <input required value={siteForm.regional} onChange={(event) => setSiteForm({ ...siteForm, regional: event.target.value })} placeholder="Ex.: CO" />
            </Field>
            <Field label="Bandeira">
              <input required value={siteForm.bandeira} onChange={(event) => setSiteForm({ ...siteForm, bandeira: event.target.value })} placeholder="Ex.: Atacadão" />
            </Field>
            <Field label="Loja">
              <input required value={siteForm.loja} onChange={(event) => setSiteForm({ ...siteForm, loja: event.target.value })} placeholder="Ex.: 123" />
            </Field>
            <Field label="VLAN 1 base" hint="Use CIDR /24 com host .0.">
              <input required value={siteForm.vlan1Cidr} onChange={(event) => setSiteForm({ ...siteForm, vlan1Cidr: event.target.value })} placeholder="10.20.25.0/24" />
            </Field>
            <Field label="Endereço">
              <input value={siteForm.endereco} onChange={(event) => setSiteForm({ ...siteForm, endereco: event.target.value })} placeholder="Endereço físico do site" />
            </Field>
            <div className="readonly-field">
              <span>Código gerado</span>
              <strong>{derivedSiteCode || "Preencha regional, bandeira e loja"}</strong>
            </div>
            <button disabled={!canWrite}>Cadastrar site</button>
          </form>

          <section className="panel">
            <div className="panel-title">
              <h3>Últimas alterações</h3>
              <p>Eventos auditados de criação, edição e geração.</p>
            </div>
            <div className="audit-list">
              {dashboard?.ultimasAlteracoes.map((item) => (
                <div key={item.id} className="audit-row">
                  <strong>{formatAuditAction(item.acao)}</strong>
                  <span>{formatEntityName(item.entidade)}</span>
                </div>
              ))}
            </div>
          </section>
        </section>

        {siteDetail && (
          <section className="detail">
            <div className="detail-head">
              <div>
                <p className="eyebrow">{siteDetail.codigoSite}</p>
                <h2>{siteDetail.labelSite}</h2>
                <p className="muted">VLAN1 {siteDetail.vlan1Cidr}</p>
                <div className="detail-actions">
                  <button className="ghost" onClick={() => void exportDocumentation()}>Exportar documentação XLSX</button>
                  <label className="file-action">
                    Importar XLSX
                    <input type="file" accept=".xlsx" onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = "";
                      if (file) void importDocumentationFile(file);
                    }} />
                  </label>
                </div>
              </div>
              <nav className="tabs">
                {["vlans", "racks", "equipamentos", "portas", "patch", "ips", "telefonia", "internet"].map((tab) => (
                  <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
                    {tabLabel(tab)}
                  </button>
                ))}
              </nav>
            </div>

            {activeTab === "vlans" && (
              <section className="section-stack">
                {editingVlanId && (
                  <form className="panel vlan-edit-form" onSubmit={(event) => void saveVlanEdit(event)}>
                    <div className="panel-title">
                      <h3>Editar VLAN</h3>
                      <p>Ajuste pontual de uma VLAN gerada pelo template.</p>
                    </div>
                    <Field label="ID da VLAN">
                      <input required type="number" min={1} value={vlanForm.vlanId} onChange={(event) => setVlanForm({ ...vlanForm, vlanId: Number(event.target.value) })} />
                    </Field>
                    <Field label="Nome da VLAN">
                      <input required value={vlanForm.vlanNome} onChange={(event) => setVlanForm({ ...vlanForm, vlanNome: event.target.value })} />
                    </Field>
                    <Field label="Rede CIDR">
                      <input required value={vlanForm.redeCidr} onChange={(event) => setVlanForm({ ...vlanForm, redeCidr: event.target.value })} />
                    </Field>
                    <Field label="Gateway">
                      <input required value={vlanForm.gateway} onChange={(event) => setVlanForm({ ...vlanForm, gateway: event.target.value })} />
                    </Field>
                    <Field label="Escopo de endereçamento">
                      <select value={vlanForm.escopoDhcp} onChange={(event) => setVlanForm({ ...vlanForm, escopoDhcp: event.target.value as DhcpScope })}>
                        <option value="DHCP">DHCP</option>
                        <option value="IP_FIXO">IP fixo</option>
                        <option value="DHCP_RELAY">DHCP relay</option>
                      </select>
                    </Field>
                    <Field label="DHCP início" hint={vlanForm.escopoDhcp === "DHCP" ? "Endereço inicial da faixa." : "Não se aplica a este escopo."}>
                      <input disabled={vlanForm.escopoDhcp !== "DHCP"} required={vlanForm.escopoDhcp === "DHCP"} value={vlanForm.dhcpInicio} onChange={(event) => setVlanForm({ ...vlanForm, dhcpInicio: event.target.value })} />
                    </Field>
                    <Field label="DHCP fim" hint={vlanForm.escopoDhcp === "DHCP" ? "Endereço final da faixa." : "Não se aplica a este escopo."}>
                      <input disabled={vlanForm.escopoDhcp !== "DHCP"} required={vlanForm.escopoDhcp === "DHCP"} value={vlanForm.dhcpFim} onChange={(event) => setVlanForm({ ...vlanForm, dhcpFim: event.target.value })} />
                    </Field>
                    <Field label="Acesso à internet">
                      <input required value={vlanForm.tipoAcessoInternet} onChange={(event) => setVlanForm({ ...vlanForm, tipoAcessoInternet: event.target.value })} />
                    </Field>
                    <label className="checkbox-field">
                      <input type="checkbox" checked={vlanForm.ativo} onChange={(event) => setVlanForm({ ...vlanForm, ativo: event.target.checked })} />
                      Ativa
                    </label>
                    <div className="form-actions">
                      <button disabled={!canWrite}>Salvar VLAN</button>
                      <button type="button" className="ghost" onClick={cancelVlanEdit}>Cancelar</button>
                    </div>
                  </form>
                )}
                <DataSection
                  title={vlanPreview.length ? "Prévia de VLANs" : "VLANs"}
                  actionLabel={vlanPreview.length ? "Limpar prévia" : "Pré-visualizar VLANs"}
                  onAction={vlanPreview.length ? () => setVlanPreview([]) : previewVlans}
                  secondaryLabel={vlanPreview.length && !vlanPreviewHasConflicts ? "Confirmar geração" : undefined}
                  onSecondary={generateVlansNow}
                >
                  {vlanPreviewHasConflicts && (
                    <div className="alert">
                      A prévia encontrou VLANs já existentes. Limpe a prévia, edite ou exclua as VLANs necessárias e gere novamente.
                    </div>
                  )}
                  <VlanTable
                    rows={vlanPreview.length ? vlanPreview : siteDetail.vlans ?? []}
                    onEdit={vlanPreview.length ? undefined : editVlan}
                    onDelete={vlanPreview.length ? undefined : (vlan) => void deleteVlan(vlan)}
                    canWrite={canWrite}
                  />
                </DataSection>
              </section>
            )}

            {activeTab === "racks" && (
              <section className="section-stack">
                <form className="rack-form" onSubmit={(event) => void createRack(event)}>
                  <Field label="Número do rack">
                    <input type="number" min={1} value={rackForm.rackNum} onChange={(event) => setRackForm({ ...rackForm, rackNum: Number(event.target.value) })} />
                  </Field>
                  <Field label="Local do rack">
                    <input required value={rackForm.localRack} onChange={(event) => setRackForm({ ...rackForm, localRack: event.target.value })} placeholder="Ex.: Sala técnica" />
                  </Field>
                  <Field label="Quantidade de switches">
                    <input type="number" min={1} value={rackForm.qtdSwitches} onChange={(event) => setRackForm({ ...rackForm, qtdSwitches: Number(event.target.value) })} />
                  </Field>
                  <button disabled={!canWrite}>Adicionar rack e gerar switches</button>
                </form>
                <div className="table">
                  <div className="row head"><span>Rack</span><span>Local</span><span>Switches</span><span>Ação</span></div>
                  {siteDetail.racks?.map((rack) => (
                    <div className="row" key={rack.id}>
                      <span>Rack {rack.rackNum}</span>
                      <span>{rack.localRack}</span>
                      <span>{rack.qtdSwitches}</span>
                      <button className="link" onClick={() => void previewSwitches(rack.id)}>Prévia dos switches</button>
                    </div>
                  ))}
                </div>
                {selectedRack && (
                  <DataSection
                    title={`Switches propostos para rack ${selectedRack.rackNum}`}
                    secondaryLabel={switchPreview.length ? "Confirmar geração" : undefined}
                    onSecondary={generateSwitchesNow}
                  >
                    <SwitchTable rows={switchPreview} />
                  </DataSection>
                )}
              </section>
            )}

            {activeTab === "equipamentos" && (
              <section className="section-stack">
                {editingEquipmentId && (
                  <form className="panel equipment-edit-form" onSubmit={(event) => void saveEquipmentEdit(event)}>
                    <div className="panel-title">
                      <h3>Editar equipamento</h3>
                      <p>Ajuste manual de hostname, IP, rack, ordem ou papel do switch.</p>
                    </div>
                    <Field label="Hostname">
                      <input required value={equipmentForm.hostname} onChange={(event) => setEquipmentForm({ ...equipmentForm, hostname: event.target.value })} />
                    </Field>
                    <Field label="IP de gerenciamento">
                      <input required value={equipmentForm.ipGerenciamento} onChange={(event) => setEquipmentForm({ ...equipmentForm, ipGerenciamento: event.target.value })} />
                    </Field>
                    <Field label="Rack">
                      <select required value={equipmentForm.rackId} onChange={(event) => {
                        const rack = siteDetail.racks?.find((item) => item.id === event.target.value);
                        setEquipmentForm({
                          ...equipmentForm,
                          rackId: event.target.value,
                          rackNum: rack?.rackNum ?? equipmentForm.rackNum,
                          localRack: rack?.localRack ?? equipmentForm.localRack
                        });
                      }}>
                        {siteDetail.racks?.map((rack) => (
                          <option key={rack.id} value={rack.id}>Rack {rack.rackNum}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Local do rack">
                      <input required value={equipmentForm.localRack} onChange={(event) => setEquipmentForm({ ...equipmentForm, localRack: event.target.value })} />
                    </Field>
                    <Field label="Ordem no rack">
                      <input type="number" min={1} value={equipmentForm.ordemNoRack} onChange={(event) => setEquipmentForm({ ...equipmentForm, ordemNoRack: Number(event.target.value) })} />
                    </Field>
                    <Field label="Ordem global">
                      <input type="number" min={1} value={equipmentForm.ordemGlobal} onChange={(event) => setEquipmentForm({ ...equipmentForm, ordemGlobal: Number(event.target.value) })} />
                    </Field>
                    <Field label="Papel do switch">
                      <select value={equipmentForm.papelSwitch} onChange={(event) => setEquipmentForm({ ...equipmentForm, papelSwitch: event.target.value })}>
                        <option value="ACCESS">ACCESS</option>
                        <option value="CORE">CORE</option>
                      </select>
                    </Field>
                    <Field label="Observação">
                      <input value={equipmentForm.observacao} onChange={(event) => setEquipmentForm({ ...equipmentForm, observacao: event.target.value })} />
                    </Field>
                    <label className="checkbox-field">
                      <input type="checkbox" checked={equipmentForm.ativo} onChange={(event) => setEquipmentForm({ ...equipmentForm, ativo: event.target.checked })} />
                      Ativo
                    </label>
                    <div className="form-actions">
                      <button disabled={!canWrite}>Salvar equipamento</button>
                      <button type="button" className="ghost" onClick={cancelEquipmentEdit}>Cancelar</button>
                    </div>
                  </form>
                )}
                <DataSection title="Equipamentos">
                  <SwitchTable
                    rows={siteDetail.equipamentos ?? []}
                    onEdit={editEquipment}
                    onDelete={(equipment) => void deleteEquipment(equipment)}
                    canWrite={canWrite}
                  />
                </DataSection>
              </section>
            )}

            {activeTab === "portas" && (
              <section className="section-stack">
                <form className="panel resource-form" onSubmit={(event) => void createSwitchPort(event)}>
                  <div className="panel-title">
                    <h3>Nova porta de switch</h3>
                    <p>Registre descrição, status e VLAN para alimentar as abas SWITCH e PATCH-PANEL da planilha.</p>
                  </div>
                  <Field label="Switch">
                    <select required value={portForm.equipamentoId} onChange={(event) => setPortForm({ ...portForm, equipamentoId: event.target.value })}>
                      {siteDetail.equipamentos?.map((item) => <option key={item.id} value={item.id}>{item.hostname}</option>)}
                    </select>
                  </Field>
                  <Field label="Porta">
                    <input type="number" min={1} value={portForm.portaNum} onChange={(event) => setPortForm({ ...portForm, portaNum: Number(event.target.value) })} />
                  </Field>
                  <Field label="Descrição">
                    <input value={portForm.descricao} onChange={(event) => setPortForm({ ...portForm, descricao: event.target.value })} placeholder="Ex.: PDV - 01" />
                  </Field>
                  <Field label="Status">
                    <select value={portForm.status} onChange={(event) => setPortForm({ ...portForm, status: event.target.value })}>
                      <option value="UP">UP</option>
                      <option value="DOWN">DOWN</option>
                      <option value="PRV">PRV</option>
                      <option value="VAGO">VAGO</option>
                    </select>
                  </Field>
                  <Field label="VLAN">
                    <select value={portForm.vlanId} onChange={(event) => setPortForm({ ...portForm, vlanId: event.target.value })}>
                      <option value="">Sem VLAN</option>
                      {siteDetail.vlans?.map((vlan) => <option key={vlan.id} value={vlan.id}>{vlan.vlanId} - {vlan.vlanNome}</option>)}
                    </select>
                  </Field>
                  <button disabled={!canWrite}>Adicionar porta</button>
                </form>
                <DataSection title="Portas por switch">
                  <div className="equipment-grid">
                    {siteDetail.equipamentos?.map((equipment) => (
                      <section className="mini-panel" key={equipment.id}>
                        <div className="mini-head">
                          <strong>{equipment.hostname}</strong>
                          <button className="link" disabled={!canWrite} onClick={() => void generatePortTemplate(equipment.id)}>Gerar 28 portas</button>
                        </div>
                        <div className="compact-list">
                          {(equipment.portas ?? []).map((port) => (
                            <span key={port.id}>{port.portaNum} - {port.descricao ?? "VAGO"} - {port.status} - {port.vlan?.vlanId ?? "-"}</span>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </DataSection>
              </section>
            )}

            {activeTab === "patch" && (
              <section className="section-stack">
                <form className="panel resource-form" onSubmit={(event) => void createPatchPanel(event)}>
                  <div className="panel-title">
                    <h3>Novo patch-panel</h3>
                    <p>Cadastre painéis físicos por rack para a aba PATCH-PANEL da planilha.</p>
                  </div>
                  <Field label="Rack">
                    <select value={patchPanelForm.rackId} onChange={(event) => {
                      const rack = siteDetail.racks?.find((item) => item.id === event.target.value);
                      setPatchPanelForm({ ...patchPanelForm, rackId: event.target.value, rackNum: rack?.rackNum ?? patchPanelForm.rackNum });
                    }}>
                      {siteDetail.racks?.map((rack) => <option key={rack.id} value={rack.id}>Rack {rack.rackNum}</option>)}
                    </select>
                  </Field>
                  <Field label="Nome">
                    <input required value={patchPanelForm.nome} onChange={(event) => setPatchPanelForm({ ...patchPanelForm, nome: event.target.value })} placeholder="PATCH-PANEL A" />
                  </Field>
                  <Field label="Descrição">
                    <input value={patchPanelForm.descricao} onChange={(event) => setPatchPanelForm({ ...patchPanelForm, descricao: event.target.value })} />
                  </Field>
                  <button disabled={!canWrite}>Adicionar patch-panel</button>
                </form>
                <DataSection title="Patch-panels">
                  <div className="table">
                    <div className="row head"><span>Nome</span><span>Rack</span><span>Descrição</span><span>Status</span></div>
                    {siteDetail.patchPanels?.map((panel) => (
                      <div className="row" key={panel.id}>
                        <span>{panel.nome}</span>
                        <span>R{panel.rackNum ?? "-"}</span>
                        <span>{panel.descricao ?? "-"}</span>
                        <span>{panel.ativo ? "Ativo" : "Inativo"}</span>
                      </div>
                    ))}
                  </div>
                </DataSection>
              </section>
            )}

            {activeTab === "ips" && (
              <section className="section-stack">
                <form className="panel resource-form" onSubmit={(event) => void createReserva(event)}>
                  <div className="panel-title">
                    <h3>Novo IP reservado</h3>
                    <p>Use IP único, faixa ou DHCP para preencher a seção de IP padrão de equipamentos.</p>
                  </div>
                  <Field label="VLAN">
                    <select required value={reservaForm.vlanId} onChange={(event) => setReservaForm({ ...reservaForm, vlanId: event.target.value })}>
                      {siteDetail.vlans?.map((vlan) => <option key={vlan.id} value={vlan.id}>{vlan.vlanId} - {vlan.vlanNome}</option>)}
                    </select>
                  </Field>
                  <Field label="Tipo">
                    <select value={reservaForm.tipoReserva} onChange={(event) => setReservaForm({ ...reservaForm, tipoReserva: event.target.value })}>
                      <option value="IP_UNICO">IP único</option>
                      <option value="FAIXA">Faixa</option>
                      <option value="DHCP">DHCP</option>
                    </select>
                  </Field>
                  <Field label="IP inicial">
                    <input disabled={reservaForm.tipoReserva === "DHCP"} value={reservaForm.ipReal} onChange={(event) => setReservaForm({ ...reservaForm, ipReal: event.target.value })} />
                  </Field>
                  <Field label="IP final">
                    <input disabled={reservaForm.tipoReserva !== "FAIXA"} value={reservaForm.ipFim} onChange={(event) => setReservaForm({ ...reservaForm, ipFim: event.target.value })} />
                  </Field>
                  <Field label="Equipamento">
                    <input value={reservaForm.hostnameEsperado} onChange={(event) => setReservaForm({ ...reservaForm, hostnameEsperado: event.target.value })} />
                  </Field>
                  <Field label="MAC">
                    <input value={reservaForm.mac} onChange={(event) => setReservaForm({ ...reservaForm, mac: event.target.value })} />
                  </Field>
                  <button disabled={!canWrite}>Adicionar IP reservado</button>
                </form>
                <DataSection title="IPs reservados">
                  <div className="table">
                    <div className="row head"><span>Equipamento</span><span>VLAN</span><span>Tipo</span><span>IP</span><span>MAC</span></div>
                    {siteDetail.vlans?.flatMap((vlan) => vlan.reservas ?? []).map((reserva) => (
                      <div className="row" key={reserva.id}>
                        <span>{reserva.hostnameEsperado ?? "-"}</span>
                        <span>{siteDetail.vlans?.find((vlan) => vlan.id === reserva.vlanId)?.vlanId ?? "-"}</span>
                        <span>{reserva.tipoReserva}</span>
                        <span>{reserva.tipoReserva === "DHCP" ? "DHCP" : reserva.ipFim ? `${reserva.ipReal} - ${reserva.ipFim}` : reserva.ipReal}</span>
                        <span>{reserva.mac ?? "-"}</span>
                      </div>
                    ))}
                  </div>
                </DataSection>
              </section>
            )}

            {activeTab === "telefonia" && (
              <section className="section-stack">
                <form className="panel resource-form" onSubmit={(event) => void saveTelefonia(event)}>
                  <div className="panel-title">
                    <h3>Telefonia do site</h3>
                    <p>Dados do PBX e senha padrão de ramais usados na aba Telefonia.</p>
                  </div>
                  <Field label="Título">
                    <input value={telefoniaForm.titulo} onChange={(event) => setTelefoniaForm({ ...telefoniaForm, titulo: event.target.value })} />
                  </Field>
                  <Field label="Modelo">
                    <input value={telefoniaForm.modelo} onChange={(event) => setTelefoniaForm({ ...telefoniaForm, modelo: event.target.value })} />
                  </Field>
                  <Field label="Tipo">
                    <input value={telefoniaForm.tipo} onChange={(event) => setTelefoniaForm({ ...telefoniaForm, tipo: event.target.value })} />
                  </Field>
                  <Field label="IP">
                    <input value={telefoniaForm.ip} onChange={(event) => setTelefoniaForm({ ...telefoniaForm, ip: event.target.value })} />
                  </Field>
                  <Field label="Senha dos ramais">
                    <input value={telefoniaForm.senhaRamais} onChange={(event) => setTelefoniaForm({ ...telefoniaForm, senhaRamais: event.target.value })} />
                  </Field>
                  <button disabled={!canWrite}>Salvar telefonia</button>
                </form>
                <form className="panel resource-form" onSubmit={(event) => void createRamal(event)}>
                  <div className="panel-title">
                    <h3>Novo ramal</h3>
                  </div>
                  <Field label="Local">
                    <input required value={ramalForm.local} onChange={(event) => setRamalForm({ ...ramalForm, local: event.target.value })} />
                  </Field>
                  <Field label="Ramal">
                    <input required value={ramalForm.ramal} onChange={(event) => setRamalForm({ ...ramalForm, ramal: event.target.value })} />
                  </Field>
                  <Field label="Liberação">
                    <input required value={ramalForm.liberacao} onChange={(event) => setRamalForm({ ...ramalForm, liberacao: event.target.value })} />
                  </Field>
                  <button disabled={!canWrite}>Adicionar ramal</button>
                </form>
                <DataSection title="Ramais">
                  <div className="table">
                    <div className="row head"><span>Local</span><span>Ramal</span><span>Liberação</span><span>Status</span></div>
                    {siteDetail.telefonia?.ramais.map((ramal) => (
                      <div className="row" key={ramal.id}>
                        <span>{ramal.local}</span>
                        <span>{ramal.ramal}</span>
                        <span>{ramal.liberacao}</span>
                        <span>{ramal.ativo ? "Ativo" : "Inativo"}</span>
                      </div>
                    ))}
                  </div>
                </DataSection>
              </section>
            )}

            {activeTab === "internet" && (
              <section className="section-stack">
                <form className="panel resource-form" onSubmit={(event) => void createInternetLink(event)}>
                  <div className="panel-title">
                    <h3>Novo link de internet</h3>
                    <p>Registre rede da operadora, IP Mikrotik, IP da operadora e velocidade.</p>
                  </div>
                  <Field label="Nome do link">
                    <input required value={linkForm.nomeLink} onChange={(event) => setLinkForm({ ...linkForm, nomeLink: event.target.value })} />
                  </Field>
                  <Field label="Tipo">
                    <input required value={linkForm.tipo} onChange={(event) => setLinkForm({ ...linkForm, tipo: event.target.value })} />
                  </Field>
                  <Field label="Rede operadora">
                    <input value={linkForm.redeOperadora} onChange={(event) => setLinkForm({ ...linkForm, redeOperadora: event.target.value })} />
                  </Field>
                  <Field label="IP Mikrotik">
                    <input value={linkForm.ipMikrotik} onChange={(event) => setLinkForm({ ...linkForm, ipMikrotik: event.target.value })} />
                  </Field>
                  <Field label="IP operadora">
                    <input value={linkForm.ipOperadora} onChange={(event) => setLinkForm({ ...linkForm, ipOperadora: event.target.value })} />
                  </Field>
                  <Field label="Velocidade">
                    <input value={linkForm.velocidade} onChange={(event) => setLinkForm({ ...linkForm, velocidade: event.target.value })} />
                  </Field>
                  <button disabled={!canWrite}>Adicionar link</button>
                </form>
                <form className="panel resource-form" onSubmit={(event) => void createInterface(event)}>
                  <div className="panel-title">
                    <h3>Nova interface Mikrotik</h3>
                  </div>
                  <Field label="Interface">
                    <input required value={interfaceForm.nome} onChange={(event) => setInterfaceForm({ ...interfaceForm, nome: event.target.value })} placeholder="ETHER 1" />
                  </Field>
                  <Field label="Descrição">
                    <input value={interfaceForm.descricao} onChange={(event) => setInterfaceForm({ ...interfaceForm, descricao: event.target.value })} />
                  </Field>
                  <Field label="IP/CIDR">
                    <input value={interfaceForm.ipCidr} onChange={(event) => setInterfaceForm({ ...interfaceForm, ipCidr: event.target.value })} />
                  </Field>
                  <Field label="Gateway">
                    <input value={interfaceForm.gateway} onChange={(event) => setInterfaceForm({ ...interfaceForm, gateway: event.target.value })} />
                  </Field>
                  <button disabled={!canWrite}>Adicionar interface</button>
                </form>
                <DataSection title="Links de internet">
                  <div className="table">
                    <div className="row head"><span>Link</span><span>Rede</span><span>Mikrotik</span><span>Operadora</span><span>Velocidade</span></div>
                    {siteDetail.linksInternet?.map((link) => (
                      <div className="row" key={link.id}>
                        <span>{link.nomeLink}</span>
                        <span>{link.redeOperadora ?? "-"}</span>
                        <span>{link.ipMikrotik ?? "-"}</span>
                        <span>{link.ipOperadora ?? link.operadora?.nome ?? "-"}</span>
                        <span>{link.velocidade ?? "-"}</span>
                      </div>
                    ))}
                  </div>
                </DataSection>
                <DataSection title="Interfaces Mikrotik">
                  <div className="table">
                    <div className="row head"><span>Interface</span><span>Descrição</span><span>IP/CIDR</span><span>Gateway</span><span>Status</span></div>
                    {siteDetail.interfaces?.map((item) => (
                      <div className="row" key={item.id}>
                        <span>{item.nome}</span>
                        <span>{item.descricao ?? "-"}</span>
                        <span>{item.ipCidr ?? "-"}</span>
                        <span>{item.gateway ?? "-"}</span>
                        <span>{item.ativo ? "Ativo" : "Inativo"}</span>
                      </div>
                    ))}
                  </div>
                </DataSection>
              </section>
            )}
          </section>
        )}
          </>
        )}
      </section>
    </main>
  );
}

function TemplateVlanManager(props: {
  canAdmin: boolean;
  editingTemplateId: string;
  form: VlanTemplateForm;
  onCancel: () => void;
  onEdit: (template: VlanTemplate) => void;
  onSubmit: (event: FormEvent) => Promise<void>;
  onUpdateForm: (form: VlanTemplateForm) => void;
  templates: VlanTemplate[];
}) {
  return (
    <section className="section-stack">
      <form className="panel template-form" onSubmit={(event) => void props.onSubmit(event)}>
        <div className="panel-title">
          <h3>{props.editingTemplateId ? "Editar template" : "Novo item do template"}</h3>
          <p>O incremento soma ao terceiro octeto da VLAN 1 do site. Ex.: VLAN 1 10.20.25.0/24 com incremento 1 gera 10.20.26.0/24.</p>
        </div>
        <Field label="Nome do template">
          <input required value={props.form.dblabel} onChange={(event) => props.onUpdateForm({ ...props.form, dblabel: event.target.value })} placeholder="PADRAO" />
        </Field>
        <Field label="ID da VLAN">
          <input required type="number" min={1} value={props.form.vlanId} onChange={(event) => props.onUpdateForm({ ...props.form, vlanId: Number(event.target.value) })} />
        </Field>
        <Field label="Nome da VLAN">
          <input required value={props.form.vlanNome} onChange={(event) => props.onUpdateForm({ ...props.form, vlanNome: event.target.value })} placeholder="Ex.: Usuários" />
        </Field>
        <Field label="Incremento do 3º octeto" hint="0 mantém o terceiro octeto da VLAN 1; 1 soma um ao terceiro octeto.">
          <input required type="number" min={0} max={255} value={props.form.baseOcteto} onChange={(event) => props.onUpdateForm({ ...props.form, baseOcteto: Number(event.target.value) })} />
        </Field>
        <Field label="Escopo de endereçamento">
          <select value={props.form.escopoDhcp} onChange={(event) => props.onUpdateForm({ ...props.form, escopoDhcp: event.target.value as DhcpScope })}>
            <option value="DHCP">DHCP</option>
            <option value="IP_FIXO">IP fixo</option>
            <option value="DHCP_RELAY">DHCP relay</option>
          </select>
        </Field>
        <Field label="DHCP início" hint={props.form.escopoDhcp === "DHCP" ? "Último octeto inicial da faixa." : "Não se aplica a este escopo."}>
          <input disabled={props.form.escopoDhcp !== "DHCP"} required={props.form.escopoDhcp === "DHCP"} type="number" min={1} max={254} value={props.form.dhcpInicio ?? ""} onChange={(event) => props.onUpdateForm({ ...props.form, dhcpInicio: optionalNumber(event.target.value) })} />
        </Field>
        <Field label="DHCP fim" hint={props.form.escopoDhcp === "DHCP" ? "Último octeto final da faixa." : "Não se aplica a este escopo."}>
          <input disabled={props.form.escopoDhcp !== "DHCP"} required={props.form.escopoDhcp === "DHCP"} type="number" min={1} max={254} value={props.form.dhcpFim ?? ""} onChange={(event) => props.onUpdateForm({ ...props.form, dhcpFim: optionalNumber(event.target.value) })} />
        </Field>
        <Field label="Gateway" hint="Último octeto do gateway.">
          <input required type="number" min={1} max={254} value={props.form.gatewayTemplate} onChange={(event) => props.onUpdateForm({ ...props.form, gatewayTemplate: Number(event.target.value) })} />
        </Field>
        <Field label="Acesso à internet">
          <input required value={props.form.tipoAcessoInternet} onChange={(event) => props.onUpdateForm({ ...props.form, tipoAcessoInternet: event.target.value })} placeholder="DIRETO, RESTRITO ou BLOQUEADO" />
        </Field>
        <label className="checkbox-field">
          <input type="checkbox" checked={props.form.ativo} onChange={(event) => props.onUpdateForm({ ...props.form, ativo: event.target.checked })} />
          Ativo
        </label>
        <div className="form-actions">
          <button disabled={!props.canAdmin}>{props.editingTemplateId ? "Salvar template" : "Criar template"}</button>
          {props.editingTemplateId && <button className="ghost" type="button" onClick={props.onCancel}>Cancelar</button>}
        </div>
      </form>

      <DataSection title="Itens cadastrados">
        <div className="table template-table">
          <div className="template-row head">
            <span>Template</span>
            <span>VLAN</span>
            <span>Nome</span>
            <span>Incremento</span>
            <span>Escopo</span>
            <span>DHCP</span>
            <span>Gateway</span>
            <span>Status</span>
            <span>Ação</span>
          </div>
          {props.templates.map((template) => (
            <div className="template-row" key={template.id}>
              <span>{template.dblabel}</span>
              <span>{template.vlanId}</span>
              <span>{template.vlanNome}</span>
              <span>{template.baseOcteto}</span>
              <span>{formatDhcpScope(template.escopoDhcp)}</span>
              <span>{formatDhcpRange(template)}</span>
              <span>{template.gatewayTemplate}</span>
              <span>{template.ativo ? "Ativo" : "Inativo"}</span>
              <button className="link" disabled={!props.canAdmin} onClick={() => props.onEdit(template)}>Editar</button>
            </div>
          ))}
        </div>
      </DataSection>
    </section>
  );
}

function LoginView({ onLogin, error }: { onLogin: (email: string, password: string) => Promise<void>; error: string }) {
  const [email, setEmail] = useState("admin@sidor.local");
  const [password, setPassword] = useState("troque-esta-senha");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onLogin(email, password);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={(event) => void submit(event)}>
        <p className="eyebrow">SIDOR</p>
        <h1>Acesso operacional</h1>
        <p className="muted">Entre com a conta local criada no bootstrap.</p>
        {error && <div className="alert">{error}</div>}
        <Field label="E-mail">
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@sidor.local" />
        </Field>
        <Field label="Senha">
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha" />
        </Field>
        <button disabled={busy}>{busy ? "Entrando..." : "Entrar"}</button>
      </form>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DataSection(props: {
  title: string;
  children: ReactNode;
  actionLabel?: string;
  secondaryLabel?: string;
  onAction?: () => void | Promise<void>;
  onSecondary?: () => void | Promise<void>;
}) {
  return (
    <section className="data-section">
      <div className="section-head">
        <h3>{props.title}</h3>
        <div>
          {props.actionLabel && <button className="ghost" onClick={() => void props.onAction?.()}>{props.actionLabel}</button>}
          {props.secondaryLabel && <button onClick={() => void props.onSecondary?.()}>{props.secondaryLabel}</button>}
        </div>
      </div>
      {props.children}
    </section>
  );
}

function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

function VlanTable(props: {
  rows: Array<(Vlan | GeneratedVlan) & { conflict?: boolean }>;
  canWrite?: boolean;
  onEdit?: (vlan: Vlan) => void;
  onDelete?: (vlan: Vlan) => void;
}) {
  const showActions = Boolean(props.onEdit || props.onDelete);
  return (
    <div className="table">
      <div className={showActions ? "vlan-row with-actions head" : "vlan-row head"}>
        <span>VLAN</span><span>Rede</span><span>Gateway</span><span>Escopo</span><span>DHCP</span><span>Internet</span>{showActions && <span>Ações</span>}
      </div>
      {props.rows.map((row) => (
        <div className={`${showActions ? "vlan-row with-actions" : "vlan-row"}${row.conflict ? " conflict" : ""}`} key={`${row.vlanId}-${row.redeCidr}`}>
          <span>{row.vlanId} - {row.vlanNome}</span>
          <span>{row.redeCidr}</span>
          <span>{row.gateway}</span>
          <span>{formatDhcpScope(row.escopoDhcp)}</span>
          <span>{formatDhcpRange(row)}</span>
          <span>{row.conflict ? "Conflito" : row.tipoAcessoInternet}</span>
          {showActions && "id" in row && (
            <span className="row-actions">
              <button className="link" disabled={!props.canWrite} onClick={() => props.onEdit?.(row)}>Editar</button>
              <button className="link danger" disabled={!props.canWrite} onClick={() => props.onDelete?.(row)}>Excluir</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function SwitchTable(props: {
  rows: Array<(Equipamento | GeneratedSwitch) & { conflict?: boolean }>;
  canWrite?: boolean;
  onEdit?: (equipment: Equipamento) => void;
  onDelete?: (equipment: Equipamento) => void;
}) {
  const showActions = Boolean(props.onEdit || props.onDelete);
  return (
    <div className="table">
      <div className={showActions ? "row with-actions head" : "row head"}>
        <span>Hostname</span><span>IP</span><span>Rack</span><span>Ordem</span><span>Papel</span>{showActions && <span>Ações</span>}
      </div>
      {props.rows.map((row) => (
        <div className={`${showActions ? "row with-actions" : "row"}${row.conflict ? " conflict" : ""}`} key={`${row.hostname}-${row.ipGerenciamento}`}>
          <span>{row.hostname}</span>
          <span>{row.ipGerenciamento}</span>
          <span>R{row.rackNum}</span>
          <span>{row.ordemGlobal}</span>
          <span>{row.conflict ? "Conflito" : row.papelSwitch}</span>
          {showActions && "id" in row && (
            <span className="row-actions">
              <button className="link" disabled={!props.canWrite} onClick={() => props.onEdit?.(row)}>Editar</button>
              <button className="link danger" disabled={!props.canWrite} onClick={() => props.onDelete?.(row)}>Excluir</button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

async function publicApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? "Falha na requisicao");
  }
  return payload as T;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

function optionalNumber(value: string) {
  return value === "" ? null : Number(value);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function formatDhcpScope(scope: DhcpScope) {
  if (scope === "IP_FIXO") return "IP fixo";
  if (scope === "DHCP_RELAY") return "DHCP relay";
  return "DHCP";
}

function formatDhcpRange(row: { escopoDhcp: DhcpScope; dhcpInicio: string | number | null; dhcpFim: string | number | null }) {
  if (row.escopoDhcp !== "DHCP") return "-";
  return `${row.dhcpInicio ?? "-"} / ${row.dhcpFim ?? "-"}`;
}

function tabLabel(tab: string) {
  const labels: Record<string, string> = {
    vlans: "VLANs",
    racks: "Racks",
    equipamentos: "Equipamentos",
    portas: "Portas",
    patch: "Patch-panel",
    ips: "IPs reservados",
    telefonia: "Telefonia",
    internet: "Internet/Mikrotik"
  };
  return labels[tab] ?? tab;
}

function formatAuditAction(action: string) {
  const labels: Record<string, string> = {
    CREATE: "Criação",
    CREATE_MANUAL: "Criação manual",
    UPDATE: "Edição",
    UPDATE_MANUAL: "Edição manual",
    DEACTIVATE: "Desativação",
    DELETE: "Exclusão",
    GENERATE_VLANS: "Geração de VLANs",
    GENERATE_SWITCHES: "Geração de switches"
  };
  return labels[action] ?? action;
}

function formatEntityName(entity: string) {
  const labels: Record<string, string> = {
    sites: "Sites",
    vlans: "VLANs",
    site_racks: "Racks",
    equipamentos: "Equipamentos",
    template_vlans: "Templates de VLANs",
    template_switch_slots: "Templates de switches",
    links_internet: "Links de internet",
    operadoras: "Operadoras",
    vlan_acesso_internet: "Acesso à internet"
  };
  return labels[entity] ?? entity;
}
