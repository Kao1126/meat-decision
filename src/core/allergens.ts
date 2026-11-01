// A fixed table, so allergy matching works across languages without depending on the LLM.
const SHELLFISH = [
  ["shrimp", "prawn", "蝦"],
  ["lobster", "龍蝦"],
  ["crab", "蟹"],
  ["clam", "蛤", "蜆"],
  ["mussel", "淡菜"],
  ["oyster", "牡蠣", "蚵"],
  ["scallop", "干貝", "帆立貝"],
  ["abalone", "鮑魚"],
];
const FISH = [["salmon", "鮭", "三文魚"], ["tuna", "鮪", "鮪魚"], ["cod", "鱈"], ["anchovy", "鯷"], ["mackerel", "鯖"]];
const MOLLUSCS = [["squid", "魷魚", "花枝"], ["octopus", "章魚"]];
const TREE_NUTS = [
  ["almond", "杏仁"],
  ["walnut", "核桃"],
  ["cashew", "腰果"],
  ["pistachio", "開心果"],
  ["hazelnut", "榛果"],
  ["pecan", "胡桃"],
  ["macadamia", "夏威夷豆"],
];

const CATEGORIES = [
  { names: ["seafood", "海鮮"], members: [...SHELLFISH, ...FISH, ...MOLLUSCS, ["fish", "魚"]] },
  { names: ["shellfish", "crustacean", "甲殼", "貝類"], members: SHELLFISH },
  { names: ["fish", "魚"], members: FISH },
  { names: ["tree nut", "nuts", "堅果"], members: TREE_NUTS },
  { names: ["peanut", "花生"], members: [["satay", "沙嗲"], ["土豆"]] },
  { names: ["egg", "蛋"], members: [["mayonnaise", "美乃滋"]] },
  {
    names: ["dairy", "milk", "lactose", "奶", "乳"],
    members: [["cheese", "起司"], ["butter", "奶油"], ["cream", "鮮奶油"], ["yogurt", "優格"]],
  },
  {
    names: ["soy", "黃豆", "大豆"],
    members: [["tofu", "豆腐"], ["soy milk", "豆漿"], ["edamame", "毛豆"], ["miso", "味噌"], ["soy sauce", "醬油"], ["豆干"], ["納豆"]],
  },
  {
    names: ["wheat", "gluten", "小麥", "麩質"],
    members: [["flour", "麵粉"], ["bread", "麵包"], ["noodle", "pasta", "麵"], ["soy sauce", "醬油"]],
  },
  { names: ["sesame", "芝麻"], members: [["tahini"], ["麻油", "香油"]] },
];

// Every term to treat as this allergy. Broad on purpose: a wrong match only hides a dish.
export function relatedTerms(value: string): string[] {
  const allergy = value.trim().toLowerCase();
  const terms = new Set([allergy]);
  const named = (term: string) => allergy.includes(term);

  for (const { names, members } of CATEGORIES) {
    if (names.some(named)) for (const term of [...names, ...members.flat()]) terms.add(term);
    for (const synonyms of members) {
      if (synonyms.some(named)) for (const term of synonyms) terms.add(term);
    }
  }
  return [...terms];
}
