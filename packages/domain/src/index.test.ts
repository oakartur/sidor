import { describe, expect, it } from "vitest";
import {
  buildSiteCode,
  generateRackSwitches,
  generateVlans,
  managementIpForOrder,
  switchHostname
} from "./index.js";

describe("switch management IP sequence", () => {
  it("uses 241-250 and then 230-239", () => {
    expect(managementIpForOrder("10.23.160.0/24", 1)).toBe("10.23.160.241");
    expect(managementIpForOrder("10.23.160.0/24", 10)).toBe("10.23.160.250");
    expect(managementIpForOrder("10.23.160.0/24", 11)).toBe("10.23.160.230");
    expect(managementIpForOrder("10.23.160.0/24", 20)).toBe("10.23.160.239");
  });

  it("blocks automatic generation after 20 switches", () => {
    expect(() => managementIpForOrder("10.23.160.0/24", 21)).toThrow(/limite de 20/);
  });
});

describe("site code generation", () => {
  it("uses Regional-Bandeira-Loja", () => {
    expect(buildSiteCode("CO", "BOMPRECO", "123")).toBe("CO-BOMPRECO-123");
  });
});

describe("switch hostname generation", () => {
  it("generates CORE only for the first switch in rack 1", () => {
    expect(switchHostname(1, 1)).toBe("R1SWCORE");
    expect(switchHostname(1, 2)).toBe("R1SWA");
    expect(switchHostname(2, 1)).toBe("R2SWA");
  });

  it("uses configured slot suffixes when templates exist", () => {
    expect(
      switchHostname(1, 1, {
        slotNum: 1,
        sufixoNormal: "A",
        sufixoR1: "CORE",
        papelSwitch: "CORE",
        ativo: true
      })
    ).toBe("R1SWCORE");
  });
});

describe("VLAN generation", () => {
  it("derives CIDR, gateway and DHCP by adding the template offset to VLAN1 third octet", () => {
    const vlans = generateVlans("10.20.25.0/24", [
      {
        dblabel: "Padrao",
        vlanId: 2,
        vlanNome: "Usuarios",
        baseOcteto: 1,
        escopoDhcp: "DHCP",
        dhcpInicio: 20,
        dhcpFim: 220,
        tipoAcessoInternet: "DIRETO",
        gatewayTemplate: 1,
        ativo: true
      }
    ]);

    expect(vlans[0]).toMatchObject({
      vlanId: 2,
      redeCidr: "10.20.26.0/24",
      gateway: "10.20.26.1",
      dhcpInicio: "10.20.26.20",
      dhcpFim: "10.20.26.220"
    });
  });

  it("generates fixed-IP VLANs without DHCP range", () => {
    const vlans = generateVlans("10.20.25.0/24", [
      {
        dblabel: "Padrao",
        vlanId: 30,
        vlanNome: "Servidores",
        baseOcteto: 5,
        escopoDhcp: "IP_FIXO",
        dhcpInicio: null,
        dhcpFim: null,
        tipoAcessoInternet: "RESTRITO",
        gatewayTemplate: 1,
        ativo: true
      }
    ]);

    expect(vlans[0]).toMatchObject({
      escopoDhcp: "IP_FIXO",
      redeCidr: "10.20.30.0/24",
      dhcpInicio: null,
      dhcpFim: null
    });
  });

  it("blocks VLAN generation when the calculated third octet exceeds 255", () => {
    expect(() =>
      generateVlans("10.20.255.0/24", [
        {
          dblabel: "Padrao",
          vlanId: 2,
          vlanNome: "Usuarios",
          baseOcteto: 1,
          escopoDhcp: "DHCP",
          dhcpInicio: 20,
          dhcpFim: 220,
          tipoAcessoInternet: "DIRETO",
          gatewayTemplate: 1,
          ativo: true
        }
      ])
    ).toThrow(/terceiro_octeto_calculado/);
  });
});

describe("rack switch generation", () => {
  it("automatically marks only the first switch in rack 1 as CORE", () => {
    const switches = generateRackSwitches({
      vlan1Cidr: "10.23.160.0/24",
      rackNum: 2,
      qtdSwitches: 2,
      existingSwitches: [
        { hostname: "R1SWCORE", ipGerenciamento: "10.23.160.241", ordemGlobal: 1 },
        { hostname: "R1SWA", ipGerenciamento: "10.23.160.242", ordemGlobal: 2 },
        { hostname: "R1SWB", ipGerenciamento: "10.23.160.243", ordemGlobal: 3 },
        { hostname: "R1SWC", ipGerenciamento: "10.23.160.244", ordemGlobal: 4 },
        { hostname: "R1SWD", ipGerenciamento: "10.23.160.245", ordemGlobal: 5 }
      ],
      slotTemplates: [
        { slotNum: 1, sufixoNormal: "A", sufixoR1: "CORE", papelSwitch: "CORE", ativo: true },
        { slotNum: 2, sufixoNormal: "B", sufixoR1: "A", papelSwitch: "ACCESS", ativo: true }
      ]
    });

    expect(switches[0]).toMatchObject({
      hostname: "R2SWA",
      ipGerenciamento: "10.23.160.246",
      papelSwitch: "ACCESS"
    });
    expect(switches[1]).toMatchObject({
      hostname: "R2SWB",
      ipGerenciamento: "10.23.160.247",
      papelSwitch: "ACCESS"
    });
  });

  it("detects duplicated hostnames and IPs against existing equipment", () => {
    expect(() =>
      generateRackSwitches({
        vlan1Cidr: "10.23.160.0/24",
        rackNum: 1,
        qtdSwitches: 1,
        existingSwitches: [{ hostname: "R1SWCORE", ipGerenciamento: "10.23.160.241", ordemGlobal: 0 }],
        slotTemplates: []
      })
    ).toThrow(/Hostname duplicado|IP de gerenciamento duplicado/);
  });
});
