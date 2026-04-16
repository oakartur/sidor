import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.templateVlan.createMany({
    data: [
      { dblabel: "PADRAO", vlanId: 1, vlanNome: "Gerencia", baseOcteto: 0, escopoDhcp: "IP_FIXO", dhcpInicio: null, dhcpFim: null, gatewayTemplate: 1, tipoAcessoInternet: "RESTRITO", ativo: true },
      { dblabel: "PADRAO", vlanId: 2, vlanNome: "Usuarios", baseOcteto: 1, escopoDhcp: "DHCP", dhcpInicio: 20, dhcpFim: 220, gatewayTemplate: 1, tipoAcessoInternet: "DIRETO", ativo: true },
      { dblabel: "PADRAO", vlanId: 3, vlanNome: "PDV", baseOcteto: 2, escopoDhcp: "DHCP", dhcpInicio: 20, dhcpFim: 220, gatewayTemplate: 1, tipoAcessoInternet: "RESTRITO", ativo: true },
      { dblabel: "PADRAO", vlanId: 4, vlanNome: "WiFi", baseOcteto: 3, escopoDhcp: "DHCP", dhcpInicio: 20, dhcpFim: 230, gatewayTemplate: 1, tipoAcessoInternet: "DIRETO", ativo: true },
      { dblabel: "PADRAO", vlanId: 5, vlanNome: "CFTV", baseOcteto: 4, escopoDhcp: "DHCP_RELAY", dhcpInicio: null, dhcpFim: null, gatewayTemplate: 1, tipoAcessoInternet: "BLOQUEADO", ativo: true }
    ],
    skipDuplicates: true
  });

  await prisma.templateSwitchSlot.createMany({
    data: [
      { slotNum: 1, sufixoNormal: "A", sufixoR1: "CORE", papelSwitch: "CORE", ativo: true },
      { slotNum: 2, sufixoNormal: "B", sufixoR1: "A", papelSwitch: "ACCESS", ativo: true },
      { slotNum: 3, sufixoNormal: "C", sufixoR1: "B", papelSwitch: "ACCESS", ativo: true },
      { slotNum: 4, sufixoNormal: "D", sufixoR1: "C", papelSwitch: "ACCESS", ativo: true },
      { slotNum: 5, sufixoNormal: "E", sufixoR1: "D", papelSwitch: "ACCESS", ativo: true },
      { slotNum: 6, sufixoNormal: "F", sufixoR1: "E", papelSwitch: "ACCESS", ativo: true },
      { slotNum: 7, sufixoNormal: "G", sufixoR1: "F", papelSwitch: "ACCESS", ativo: true },
      { slotNum: 8, sufixoNormal: "H", sufixoR1: "G", papelSwitch: "ACCESS", ativo: true },
      { slotNum: 9, sufixoNormal: "I", sufixoR1: "H", papelSwitch: "ACCESS", ativo: true },
      { slotNum: 10, sufixoNormal: "J", sufixoR1: "I", papelSwitch: "ACCESS", ativo: true }
    ],
    skipDuplicates: true
  });

  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@sidor.local";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "troque-esta-senha";
  const adminName = process.env.ADMIN_NAME ?? "Administrador";
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { nome: adminName, passwordHash, role: UserRole.ADMIN, ativo: true },
    create: { nome: adminName, email: adminEmail, passwordHash, role: UserRole.ADMIN, ativo: true }
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
