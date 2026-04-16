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
  const [activeTab, setActiveTab] = useState("vlans");
  const [search, setSearch] = useState("");
  const [vlanPreview, setVlanPreview] = useState<GeneratedVlan[]>([]);
  const [switchPreview, setSwitchPreview] = useState<GeneratedSwitch[]>([]);
  const [selectedRackId, setSelectedRackId] = useState("");
  const [siteForm, setSiteForm] = useState({
    codigoSite: "",
    regional: "",
    bandeira: "",
    loja: "",
    vlan1Cidr: "",
    endereco: ""
  });
  const [rackForm, setRackForm] = useState({ rackNum: 1, localRack: "", qtdSwitches: 1 });

  const canWrite = user?.role === "ADMIN" || user?.role === "OPERADOR";
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
    setSiteForm({ codigoSite: "", regional: "", bandeira: "", loja: "", vlan1Cidr: "", endereco: "" });
    await loadSites();
    setSelectedSiteId(created.id);
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
            <p className="eyebrow">Painel</p>
            <h2>{siteDetail?.labelSite ?? "Selecione ou cadastre um site"}</h2>
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

        <section className="split">
          <form className="panel" onSubmit={(event) => void createSite(event)}>
            <div className="panel-title">
              <h3>Novo site</h3>
              <p>Informe a VLAN1 base no formato 10.23.160.0/24.</p>
            </div>
            <input required placeholder="Codigo do site" value={siteForm.codigoSite} onChange={(event) => setSiteForm({ ...siteForm, codigoSite: event.target.value })} />
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
      </section>
    </main>
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
