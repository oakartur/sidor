import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";

type Role = "ADMIN" | "OPERADOR" | "LEITURA";

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
  dhcpInicio: string;
  dhcpFim: string;
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
  hostname: string;
  ipGerenciamento: string;
  localRack: string;
  rackNum: number;
  ordemNoRack: number;
  ordemGlobal: number;
  papelSwitch: string;
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
  dhcpInicio: string;
  dhcpFim: string;
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
  dhcpInicio: number;
  dhcpFim: number;
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
    dhcpInicio: 20,
    dhcpFim: 220,
    gatewayTemplate: 1,
    tipoAcessoInternet: "DIRETO",
    ativo: true
  });

  const canWrite = user?.role === "ADMIN" || user?.role === "OPERADOR";
  const canAdmin = user?.role === "ADMIN";
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
    const rack = await api<Rack>(`/api/sites/${siteDetail.id}/racks`, {
      method: "POST",
      body: JSON.stringify(rackForm)
    });
    setRackForm({ rackNum: rackForm.rackNum + 1, localRack: "", qtdSwitches: 1 });
    setSelectedRackId(rack.id);
    await loadSiteDetail(siteDetail.id);
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
    await loadSiteDetail(siteDetail.id);
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
          <h1>Documentacao de rede</h1>
          <p className="muted">Operacao de sites, VLANs, racks, switches e links.</p>
        </div>
        <nav className="main-menu">
          <button className={activeView === "operacao" ? "active" : ""} onClick={() => setActiveView("operacao")}>
            Operacao
          </button>
          <button className={activeView === "templateVlans" ? "active" : ""} onClick={() => setActiveView("templateVlans")}>
            Template VLANs
          </button>
        </nav>
        <label className="search">
          Buscar
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Site, IP ou codigo" />
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
            <p className="eyebrow">{activeView === "operacao" ? "Painel" : "Administracao"}</p>
            <h2>{activeView === "operacao" ? siteDetail?.labelSite ?? "Selecione ou cadastre um site" : "Template das VLANs"}</h2>
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
              <p>O codigo sera gerado como Regional-Bandeira-Loja. Informe a VLAN1 base no formato 10.23.160.0/24.</p>
            </div>
            <input required placeholder="Regional" value={siteForm.regional} onChange={(event) => setSiteForm({ ...siteForm, regional: event.target.value })} />
            <input required placeholder="Bandeira" value={siteForm.bandeira} onChange={(event) => setSiteForm({ ...siteForm, bandeira: event.target.value })} />
            <input required placeholder="Loja" value={siteForm.loja} onChange={(event) => setSiteForm({ ...siteForm, loja: event.target.value })} />
            <input required placeholder="VLAN1 CIDR" value={siteForm.vlan1Cidr} onChange={(event) => setSiteForm({ ...siteForm, vlan1Cidr: event.target.value })} />
            <input placeholder="Endereco" value={siteForm.endereco} onChange={(event) => setSiteForm({ ...siteForm, endereco: event.target.value })} />
            <button disabled={!canWrite}>Cadastrar site</button>
          </form>

          <section className="panel">
            <div className="panel-title">
              <h3>Ultimas alteracoes</h3>
              <p>Eventos auditados de criacao, edicao e geracao.</p>
            </div>
            <div className="audit-list">
              {dashboard?.ultimasAlteracoes.map((item) => (
                <div key={item.id} className="audit-row">
                  <strong>{item.acao}</strong>
                  <span>{item.entidade}</span>
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
                    {tab}
                  </button>
                ))}
              </nav>
            </div>

            {activeTab === "vlans" && (
              <DataSection
                title="VLANs"
                actionLabel="Pre-visualizar VLANs"
                onAction={previewVlans}
                secondaryLabel={vlanPreview.length ? "Confirmar geracao" : undefined}
                onSecondary={generateVlansNow}
              >
                <VlanTable rows={vlanPreview.length ? vlanPreview : siteDetail.vlans ?? []} />
              </DataSection>
            )}

            {activeTab === "racks" && (
              <section className="section-stack">
                <form className="rack-form" onSubmit={(event) => void createRack(event)}>
                  <input type="number" min={1} value={rackForm.rackNum} onChange={(event) => setRackForm({ ...rackForm, rackNum: Number(event.target.value) })} />
                  <input required placeholder="Local do rack" value={rackForm.localRack} onChange={(event) => setRackForm({ ...rackForm, localRack: event.target.value })} />
                  <input type="number" min={1} value={rackForm.qtdSwitches} onChange={(event) => setRackForm({ ...rackForm, qtdSwitches: Number(event.target.value) })} />
                  <button disabled={!canWrite}>Adicionar rack</button>
                </form>
                <div className="table">
                  <div className="row head"><span>Rack</span><span>Local</span><span>Switches</span><span>Acao</span></div>
                  {siteDetail.racks?.map((rack) => (
                    <div className="row" key={rack.id}>
                      <span>Rack {rack.rackNum}</span>
                      <span>{rack.localRack}</span>
                      <span>{rack.qtdSwitches}</span>
                      <button className="link" onClick={() => void previewSwitches(rack.id)}>Previa switches</button>
                    </div>
                  ))}
                </div>
                {selectedRack && (
                  <DataSection
                    title={`Switches propostos para rack ${selectedRack.rackNum}`}
                    secondaryLabel={switchPreview.length ? "Confirmar geracao" : undefined}
                    onSecondary={generateSwitchesNow}
                  >
                    <SwitchTable rows={switchPreview} />
                  </DataSection>
                )}
              </section>
            )}

            {activeTab === "equipamentos" && (
              <DataSection title="Equipamentos">
                <SwitchTable rows={siteDetail.equipamentos ?? []} />
              </DataSection>
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
          <p>O incremento soma ao terceiro octeto da VLAN1 do site. Ex.: VLAN1 10.20.25.0/24 com incremento 1 gera 10.20.26.0/24.</p>
        </div>
        <input required placeholder="Label do template" value={props.form.dblabel} onChange={(event) => props.onUpdateForm({ ...props.form, dblabel: event.target.value })} />
        <input required type="number" min={1} placeholder="VLAN ID" value={props.form.vlanId} onChange={(event) => props.onUpdateForm({ ...props.form, vlanId: Number(event.target.value) })} />
        <input required placeholder="Nome da VLAN" value={props.form.vlanNome} onChange={(event) => props.onUpdateForm({ ...props.form, vlanNome: event.target.value })} />
        <input required type="number" min={0} max={255} placeholder="Incremento 3o octeto" value={props.form.baseOcteto} onChange={(event) => props.onUpdateForm({ ...props.form, baseOcteto: Number(event.target.value) })} />
        <input required type="number" min={1} max={254} placeholder="DHCP inicio" value={props.form.dhcpInicio} onChange={(event) => props.onUpdateForm({ ...props.form, dhcpInicio: Number(event.target.value) })} />
        <input required type="number" min={1} max={254} placeholder="DHCP fim" value={props.form.dhcpFim} onChange={(event) => props.onUpdateForm({ ...props.form, dhcpFim: Number(event.target.value) })} />
        <input required type="number" min={1} max={254} placeholder="Gateway" value={props.form.gatewayTemplate} onChange={(event) => props.onUpdateForm({ ...props.form, gatewayTemplate: Number(event.target.value) })} />
        <input required placeholder="Tipo acesso internet" value={props.form.tipoAcessoInternet} onChange={(event) => props.onUpdateForm({ ...props.form, tipoAcessoInternet: event.target.value })} />
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
            <span>DHCP</span>
            <span>Gateway</span>
            <span>Status</span>
            <span>Acao</span>
          </div>
          {props.templates.map((template) => (
            <div className="template-row" key={template.id}>
              <span>{template.dblabel}</span>
              <span>{template.vlanId}</span>
              <span>{template.vlanNome}</span>
              <span>{template.baseOcteto}</span>
              <span>{template.dhcpInicio}-{template.dhcpFim}</span>
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
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Senha" />
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

function VlanTable({ rows }: { rows: Array<(Vlan | GeneratedVlan) & { conflict?: boolean }> }) {
  return (
    <div className="table">
      <div className="row head"><span>VLAN</span><span>Rede</span><span>Gateway</span><span>DHCP</span><span>Internet</span></div>
      {rows.map((row) => (
        <div className={row.conflict ? "row conflict" : "row"} key={`${row.vlanId}-${row.redeCidr}`}>
          <span>{row.vlanId} - {row.vlanNome}</span>
          <span>{row.redeCidr}</span>
          <span>{row.gateway}</span>
          <span>{row.dhcpInicio} / {row.dhcpFim}</span>
          <span>{row.conflict ? "Conflito" : row.tipoAcessoInternet}</span>
        </div>
      ))}
    </div>
  );
}

function SwitchTable({ rows }: { rows: Array<(Equipamento | GeneratedSwitch) & { conflict?: boolean }> }) {
  return (
    <div className="table">
      <div className="row head"><span>Hostname</span><span>IP</span><span>Rack</span><span>Ordem</span><span>Papel</span></div>
      {rows.map((row) => (
        <div className={row.conflict ? "row conflict" : "row"} key={`${row.hostname}-${row.ipGerenciamento}`}>
          <span>{row.hostname}</span>
          <span>{row.ipGerenciamento}</span>
          <span>R{row.rackNum}</span>
          <span>{row.ordemGlobal}</span>
          <span>{row.conflict ? "Conflito" : row.papelSwitch}</span>
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
