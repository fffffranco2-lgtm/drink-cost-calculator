/**
 * Seed inicial de ingredientes e drinks para uma instalação vazia.
 * Extraído de app/admin/page.tsx e usado apenas quando o estado remoto
 * está comprovadamente vazio (não apenas ainda não hidratado).
 */

import { type Drink, type Ingredient, uid } from "@/app/admin/admin-types";

export function buildInitialSeed(): { ingredients: Ingredient[]; drinks: Drink[] } {
  const gin: Ingredient = {
    id: uid("ing"),
    name: "Gin (750ml)",
    category: "destilados_base",
    pricingModel: "by_bottle",
    bottlePrice: 120,
    bottleMl: 750,
    yieldMl: 720,
    lossPct: 0,
  };
  const vodka: Ingredient = {
    id: uid("ing"),
    name: "Vodka (750ml)",
    category: "destilados_base",
    pricingModel: "by_bottle",
    bottlePrice: 95,
    bottleMl: 750,
    yieldMl: 720,
    lossPct: 0,
  };
  const campari: Ingredient = {
    id: uid("ing"),
    name: "Campari (750ml)",
    category: "amaros_aperitivos",
    pricingModel: "by_bottle",
    bottlePrice: 110,
    bottleMl: 750,
    yieldMl: 720,
    lossPct: 0,
  };
  const vermuteRosso: Ingredient = {
    id: uid("ing"),
    name: "Vermute Rosso (1L)",
    category: "fortificados",
    pricingModel: "by_bottle",
    bottlePrice: 80,
    bottleMl: 1000,
    yieldMl: 950,
    lossPct: 0,
  };
  const lillet: Ingredient = {
    id: uid("ing"),
    name: "Lillet Blanc (750ml)",
    category: "fortificados",
    pricingModel: "by_bottle",
    bottlePrice: 140,
    bottleMl: 750,
    yieldMl: 720,
    lossPct: 0,
  };
  const angostura: Ingredient = {
    id: uid("ing"),
    name: "Angostura (bitters)",
    category: "bitters",
    pricingModel: "by_bottle",
    bottlePrice: 70,
    bottleMl: 200,
    yieldMl: 190,
    lossPct: 0,
  };
  const orangePeel: Ingredient = {
    id: uid("ing"),
    name: "Casca de laranja (garnish)",
    category: "garnish",
    pricingModel: "by_unit",
    costPerUnit: 0.4,
  };
  const lemonPeel: Ingredient = {
    id: uid("ing"),
    name: "Casca de limão (garnish)",
    category: "garnish",
    pricingModel: "by_unit",
    costPerUnit: 0.35,
  };

  const hanky: Drink = {
    id: uid("drink"),
    name: "Hanky Panky",
    showOnPublicMenu: true,
    publicMenuPriceMode: "markup",
    manualPublicPrice: 0,
    items: [
      { ingredientId: gin.id, qty: 45, unit: "ml" },
      { ingredientId: vermuteRosso.id, qty: 45, unit: "ml" },
      { ingredientId: angostura.id, qty: 1, unit: "dash" },
      { ingredientId: orangePeel.id, qty: 1, unit: "un" },
    ],
  };

  const negroni: Drink = {
    id: uid("drink"),
    name: "Negroni",
    showOnPublicMenu: true,
    publicMenuPriceMode: "cmv",
    manualPublicPrice: 0,
    items: [
      { ingredientId: gin.id, qty: 30, unit: "ml" },
      { ingredientId: campari.id, qty: 30, unit: "ml" },
      { ingredientId: vermuteRosso.id, qty: 30, unit: "ml" },
      { ingredientId: orangePeel.id, qty: 1, unit: "un" },
    ],
  };

  const vesper: Drink = {
    id: uid("drink"),
    name: "Vesper (teste)",
    showOnPublicMenu: false,
    publicMenuPriceMode: "manual",
    manualPublicPrice: 39.9,
    items: [
      { ingredientId: gin.id, qty: 60, unit: "ml" },
      { ingredientId: vodka.id, qty: 15, unit: "ml" },
      { ingredientId: lillet.id, qty: 8, unit: "ml" },
      { ingredientId: lemonPeel.id, qty: 1, unit: "un" },
    ],
  };

  return {
    ingredients: [gin, vodka, campari, vermuteRosso, lillet, angostura, orangePeel, lemonPeel],
    drinks: [hanky, negroni, vesper],
  };
}
