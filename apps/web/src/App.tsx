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
}

interface LinkInternet {
  id: string;
  nomeLink: string;
  tipo: string;
  ativo: boolean;
  operadora?: { nome: string };
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
    setSiteDetail(await api<Site>(`/api/sites/${siteId}`));
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
              </div>
              <nav className="tabs">
                {["vlans", "racks", "equipamentos", "internet"].map((tab) => (
                  <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
                    {tab === "vlans" ? "VLANs" : tab === "racks" ? "Racks" : tab === "equipamentos" ? "Equipamentos" : "Internet"}
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

            {activeTab === "internet" && (
              <DataSection title="Links de internet">
                <div className="table">
                  <div className="row head"><span>Link</span><span>Tipo</span><span>Operadora</span><span>Status</span></div>
                  {siteDetail.linksInternet?.map((link) => (
                    <div className="row" key={link.id}>
                      <span>{link.nomeLink}</span>
                      <span>{link.tipo}</span>
                      <span>{link.operadora?.nome ?? "-"}</span>
                      <span>{link.ativo ? "Ativo" : "Inativo"}</span>
                    </div>
                  ))}
                </div>
              </DataSection>
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

function formatDhcpScope(scope: DhcpScope) {
  if (scope === "IP_FIXO") return "IP fixo";
  if (scope === "DHCP_RELAY") return "DHCP relay";
  return "DHCP";
}

function formatDhcpRange(row: { escopoDhcp: DhcpScope; dhcpInicio: string | number | null; dhcpFim: string | number | null }) {
  if (row.escopoDhcp !== "DHCP") return "-";
  return `${row.dhcpInicio ?? "-"} / ${row.dhcpFim ?? "-"}`;
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
