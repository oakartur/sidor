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
  it("derives CIDR, gateway and DHCP from VLAN1 and template octet", () => {
    const vlans = generateVlans("10.23.160.0/24", [
      {
        dblabel: "Padrao",
        vlanId: 20,
        vlanNome: "Usuarios",
        baseOcteto: 161,
        dhcpInicio: 20,
        dhcpFim: 220,
        tipoAcessoInternet: "DIRETO",
        gatewayTemplate: 1,
        ativo: true
      }
    ]);

    expect(vlans[0]).toMatchObject({
      vlanId: 20,
      redeCidr: "10.23.161.0/24",
      gateway: "10.23.161.1",
      dhcpInicio: "10.23.161.20",
      dhcpFim: "10.23.161.220"
    });
  });
});

describe("rack switch generation", () => {
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
