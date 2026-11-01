// Replies written by code rather than the LLM, so they still work when the LLM fails.
const ENGLISH = {
  notUnderstood: 'Sorry, I didn\'t catch that. Try "Add mapo tofu: tofu, pork", "I had ramen for lunch" or "What should I have for dinner?".',
  noSuggestion: 'I don\'t have a recent suggestion to pick from. Try "What should I have for dinner?".',
  defaultIntro: "Here are some ideas:",
  unknownIngredients: (dishes: string[]) => `I don't know what's in ${dishes.join(", ")}, so I couldn't check for your allergies.`,
  failure: "Sorry, something went wrong on my side. Please try again.",
  linkUnclear: "I couldn't tell which dish that is. Send the link again with its name, like \"Beef noodles <link>\".",
  tryList: "try list",
};

const CHINESE: typeof ENGLISH = {
  notUnderstood: "抱歉，我沒聽懂。可以試試「新增麻婆豆腐：豆腐、豬肉」、「午餐吃了拉麵」或「晚餐吃什麼？」。",
  noSuggestion: "目前沒有可以選的推薦。可以先問我「晚餐吃什麼？」。",
  defaultIntro: "這裡有幾個選擇：",
  unknownIngredients: (dishes) => `我不知道${dishes.join("、")}的食材，所以無法確認是否含有你的過敏原。`,
  failure: "抱歉，系統出了點問題，請再試一次。",
  linkUnclear: "我看不出這是哪道菜。請把菜名和連結一起再傳一次，例如「牛肉麵 <連結>」。",
  tryList: "想吃清單",
};

export type Messages = typeof ENGLISH;

export function messagesFor(text: string): Messages {
  return /\p{Script=Han}/u.test(text) ? CHINESE : ENGLISH;
}
