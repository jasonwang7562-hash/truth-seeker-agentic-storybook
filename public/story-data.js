(function () {
  const scene = (name) => `/assets/scenes/${name}`;

  const factualCategories = {
    UNDERSTANDS: {
      description: "表达了 checkpoint 想观察的事实或推理。",
      exampleSignals: ["能指出证据", "能说明话术或群体行为为什么可疑"],
    },
    PARTIAL: {
      description: "已经接近目标，但还没有说清关键证据或原因。",
      exampleSignals: ["感觉不对", "提出怀疑但没有说明依据"],
    },
    MISUNDERSTANDS: {
      description: "相信了故事角色的说法，或把虚构解释当成直接观察。",
      exampleSignals: ["认为骗子一定有布", "认为大家都看见了所以一定是真的"],
    },
    UNSURE: {
      description: "明确表示不知道、无法判断，或回答信息太少。",
      exampleSignals: ["不知道", "不确定", "说不清"],
    },
    OFF_TOPIC: {
      description: "回答与当前问题没有关系。",
      exampleSignals: ["只谈衣服颜色", "讲述无关的个人经历"],
    },
  };

  const reflectionCategories = {
    SPEAK_TRUTH: {
      description: "表示会说出自己的真实观察或提醒别人。",
      exampleSignals: ["我会说出来", "我会告诉大家没有衣服"],
    },
    AFRAID_OR_HESITANT: {
      description: "表达害怕、犹豫，或需要先确认安全。",
      exampleSignals: ["我会害怕", "我可能不敢说"],
    },
    FOLLOW_CROWD: {
      description: "表示会先跟着人群，或因为压力不表达。",
      exampleSignals: ["我会跟大家一起说", "我不想被别人笑"],
    },
    OTHER_REFLECTION: {
      description: "提出了其他合理的个人想法，不需要被判定为对错。",
      exampleSignals: ["我会先问爸爸妈妈", "我不知道但会观察一下"],
    },
  };

  const guideClues = [
    {
      id: "clue-strange-words",
      label: "线索 1",
      title: "奇怪的话语",
      text: "“只有聪明的人才能看见”会让人害怕承认自己没有看见。",
    },
    {
      id: "clue-empty-loom",
      label: "线索 2",
      title: "空空的织布机",
      text: "织布机可以发出声音、做出动作，可是始终没有出现真正的布。",
    },
    {
      id: "clue-mirror-truth",
      label: "线索 3",
      title: "不敢说出口",
      text: "皇帝好像也没看见新衣，可他害怕别人说自己不聪明。",
    },
    {
      id: "clue-crowd-conformity",
      label: "线索 4",
      title: "大家都在跟着别人说",
      text: "很多人没有亲眼看见，却因为害怕或从众继续称赞新衣。",
    },
  ];

  const guideCheckpoints = [
    {
      id: "checkpoint-wardrobe-motivation",
      pageId: "wardrobe",
      question: "咦……这么多衣服还不够呀？你觉得他为什么一直想换新的？",
      educationalGoal: "轻量建立皇帝爱漂亮、很在意衣服与外表的人物特点。",
      rubric: { type: "factual", categories: factualCategories },
      retryGuidance: {
        first: "看看这一屋子的衣服和皇冠，他是不是有点太在意啦？",
        exhausted: "那我们先不急。看看这一屋子的衣服和皇冠，说不定等下就知道了。",
      },
      maxAttempts: 1,
      authoredFallback: {
        category: "UNSURE",
        feedback: "那我们先不急。看看这一屋子的衣服和皇冠，说不定等下就知道了。",
        shouldRetry: false,
        awardClue: false,
        continueStory: true,
      },
    },
    {
      id: "checkpoint-suspicious-wording",
      pageId: "scammers",
      question:
        "他们怎么每次都不直接回答呀？刚才那句“只有聪明的人才能看见”……你觉得哪里怪怪的？",
      educationalGoal:
        "注意骗子制造的社会压力：他们把能不能看见布，和孩子是不是聪明联系在一起。",
      rubric: { type: "factual", categories: factualCategories },
      retryGuidance: {
        first: "换成是你呢？如果你什么都没看见，你敢直接说“我看不见”吗？",
        exhausted: "那我们继续看看，他们能不能织出这件衣服吧。。",
      },
      maxAttempts: 2,
      clueId: "clue-strange-words",
      cluePolicy: { onUnderstands: true, afterMaxAttempts: true },
      authoredFallback: {
        category: "UNSURE",
        feedback: "换成是你呢？如果你什么都没看见，你敢直接说“我看不见”吗？",
        shouldRetry: true,
        awardClue: false,
        continueStory: false,
      },
    },
    {
      id: "checkpoint-empty-loom",
      pageId: "weaving",
      question: "嘘……你看到布了吗？",
      educationalGoal: "区分自己直接观察到的证据和别人对织布机的说法。",
      rubric: { type: "factual", categories: factualCategories },
      retryGuidance: {
        first: "我也觉得有点不对。再看看——有颜色吗？有布边吗？",
        exhausted: "好，我们先把这个猜想留着。继续看看他们会拿出什么来。",
      },
      maxAttempts: 2,
      clueId: "clue-empty-loom",
      cluePolicy: { onUnderstands: true, afterMaxAttempts: true },
      authoredFallback: {
        category: "UNSURE",
        feedback: "我也觉得有点不对。再看看——有颜色吗？有布边吗？",
        shouldRetry: true,
        awardClue: false,
        continueStory: false,
      },
    },
    {
      id: "checkpoint-mirror-truth",
      pageId: "mirror",
      question: "咦……他真的看见了吗？",
      educationalGoal: "理解皇帝明明没有看见，却因为害怕被认为愚蠢或不称职而不敢承认。",
      rubric: { type: "factual", categories: factualCategories },
      retryGuidance: {
        first: "那他怎么也跟着说好看呢？想想骗子刚才那句话——“只有聪明的人才看得见”。",
        exhausted: "先记着这个奇怪的地方。我们去看看其他人会不会也这样。",
      },
      maxAttempts: 2,
      clueId: "clue-mirror-truth",
      cluePolicy: { onUnderstands: true, afterMaxAttempts: true },
      authoredFallback: {
        category: "UNSURE",
        feedback: "想想骗子刚才那句话——“只有聪明的人才看得见”。",
        shouldRetry: true,
        awardClue: false,
        continueStory: false,
      },
    },
    {
      id: "checkpoint-parade-conformity",
      pageId: "parade",
      question: "等等……他们嘴上说的，怎么跟心里想的不太一样？",
      educationalGoal: "理解害怕、从众和社会压力怎样让人跟着别人说话。",
      rubric: { type: "factual", categories: factualCategories },
      retryGuidance: {
        first: "那我们再想象一下，人们嘴上在夸，心里可能怎么想呢？",
        exhausted: "可是我们刚才看到的织布机，明明是空的呀？",
      },
      maxAttempts: 2,
      clueId: "clue-crowd-conformity",
      cluePolicy: { onUnderstands: true, afterMaxAttempts: true },
      authoredFallback: {
        category: "UNSURE",
        feedback: "那我们再想象一下，人们嘴上在夸，心里可能怎么想呢？",
        shouldRetry: true,
        awardClue: false,
        continueStory: false,
      },
    },
    {
      id: "checkpoint-final-reflection",
      pageId: "truth",
      question: "刚才那么多大人都没敢说……如果你也站在那里，你会说什么？",
      educationalGoal: "把故事里的观察和压力，联系到孩子自己的想法与选择。",
      rubric: { type: "reflection", categories: reflectionCategories },
      retryGuidance: {
        first: "那如果旁边有一个人先说了真话呢？",
        exhausted: "嗯……那你觉得，故事里的那个孩子为什么敢说出来？",
      },
      maxAttempts: 1,
      authoredFallback: {
        category: "OTHER_REFLECTION",
        feedback: "嗯……那你觉得，故事里的那个孩子为什么敢说出来？",
        shouldRetry: false,
        awardClue: false,
        continueStory: true,
      },
    },
  ];

  function unitAudio(sceneName, fileName) {
    return `/assets/audio/units/${sceneName}/${fileName}.mp3`;
  }

  function narration(text, audioSrc = null) {
    return { type: "narration", text, audioSrc };
  }

  function dialogue(speaker, text, audioSrc = null) {
    return { type: "dialogue", speaker, text, audioSrc };
  }

  function question(checkpointId) {
    return { type: "question", checkpointId };
  }

  function unitLiteraryText(unit) {
    if (!unit) return "";
    if (unit.type === "narration") return unit.text || "";
    if (unit.type === "dialogue") return `${unit.speaker || "角色"}：“${unit.text || ""}”`;
    return "";
  }

  function sceneTextFromUnits(units, range) {
    const source = range || units;
    return source
      .map(unitLiteraryText)
      .filter(Boolean)
      .join("");
  }

  function splitUnitsAroundQuestion(units) {
    const questionIndex = units.findIndex((unit) => unit.type === "question");
    if (questionIndex < 0) {
      return { before: units, after: [], checkpointId: "" };
    }
    return {
      before: units.slice(0, questionIndex),
      after: units.slice(questionIndex + 1),
      checkpointId: units[questionIndex].checkpointId || "",
    };
  }

  function storyScene(config) {
    const split = splitUnitsAroundQuestion(config.units || []);
    return {
      ...config,
      checkpointId: split.checkpointId || config.checkpointId,
      narrationText: sceneTextFromUnits(config.units, split.before),
      narrationAfterInteraction: sceneTextFromUnits(config.units, split.after) || undefined,
      fullText: sceneTextFromUnits(config.units),
    };
  }

  globalThis.EAZO_STORY = {
    metadata: {
      title: "皇帝的新衣",
      subtitle: "AI 互动绘本 MVP",
      ageRange: "5-10",
      coreLoop: "READ -> OBSERVE -> INTERACT -> RESPONSE -> REFLECT -> CONTINUE",
      runtime: "unit-storybook",
    },
    agent: {
      id: "guide",
      role: "小侦探搭档",
      architecture: "single-guide",
      goal: "像一起看故事的小侦探搭档，在关键节点陪孩子观察画面和证据，不控制故事顺序。",
    },
    checkpoints: guideCheckpoints,
    clues: guideClues,
    characterProfiles: {
      scammer: {
        role: "假裁缝",
        goal: "维持神奇布料的说法",
        secret: "没有真正的神奇布料",
        style: "奉承、回避证据、简短、儿童安全",
      },
      guide: {
        role: "小侦探搭档",
        goal: "接住孩子的话，再把注意力带回故事细节",
        style: "自然口语、短、轻、具体，不评价孩子聪明或正确",
      },
    },
    pages: [
      {
        id: "entry",
        type: "entry",
        chapter: "故事入口",
        title: "皇帝的新衣",
        image: scene("title.jpg"),
        aspect: "1574 / 1178",
        units: [
          narration("今天我们一起读《皇帝的新衣》。"),
          narration("先看看、试试，再想一想：大家说的话，和你亲眼看见的一样吗？"),
        ],
        guide:
          "今天我们不急着判断谁对谁错。先看看、试试，再想一想大家说的话和你看见的一样吗。",
      },
      storyScene({
        id: "wardrobe",
        type: "wardrobe",
        chapter: "1 皇帝的衣帽间",
        title: "皇帝的衣帽间",
        image: scene("wardrobe.jpg"),
        aspect: "1562 / 1178",
        units: [
          narration(
            "许多年以前，有一位国王非常喜欢漂亮的新衣服。",
            unitAudio("场景一", "许多年以前，有一位国王非常喜欢漂亮的新衣服。")
          ),
          narration(
            "他把大量的钱都花在衣服上，不关心军队，也不喜欢看戏或处理政事。",
            unitAudio("场景一", "他把大量的钱都花在衣服上，不关心军队，也不喜欢看戏或处理政事。")
          ),
          question("checkpoint-wardrobe-motivation"),
          narration(
            "他每天不停地更换新衣。别人提到别的皇帝时，会说：“皇上在会议室里。”",
            unitAudio("场景一", "他每天不停地更换新衣。别人提到别的皇帝时，会说：“皇上在会议室里。”")
          ),
          narration(
            "但提到他时，大家总会说：“皇上在更衣室里。”",
            unitAudio("场景一", "但提到他时，大家总会说：“皇上在更衣室里。”")
          ),
        ],
        guide: "看看这一屋子的衣服。",
      }),
      storyScene({
        id: "scammers",
        type: "scammers",
        chapter: "2 两个骗子来到王宫",
        title: "两个骗子来到王宫",
        image: scene("scammers-questions.jpg"),
        alternateImage: scene("scammers-evidence.jpg"),
        aspect: "2264 / 1536",
        units: [
          narration(
            "一天，城里来了两个裁缝，自称是技艺高超的织工。",
            unitAudio("场景二", "一天，城里来了两个裁缝，自称是技艺高超的织工。")
          ),
          dialogue(
            "两个裁缝",
            "我们能织出世界上最漂亮的布，",
            unitAudio("场景二", "他们告诉国王：“我们能织出世界上最漂亮的布，")
          ),
          dialogue(
            "两个裁缝",
            "而且这种布非常神奇，只有聪明、称职的人才能看见，",
            unitAudio("场景二", "而且这种布非常神奇——只有聪明、称职的人才能看见，")
          ),
          dialogue(
            "两个裁缝",
            "愚蠢或不称职的人什么也看不到。",
            unitAudio("场景二", "愚蠢或不称职的人什么也看不到。")
          ),
          question("checkpoint-suspicious-wording"),
          narration(
            "国王一听，非常高兴。“有了这种衣服，我就能知道谁聪明，谁不称职了！”",
            unitAudio("场景二", "国王一听，非常高兴。“有了这种衣服，我就能知道谁聪明，谁不称职了！”")
          ),
          narration(
            "于是，他给了两个裁缝许多金钱和材料，让他们马上开始织布。",
            unitAudio("场景二", "于是，他给了两个裁缝许多金钱和材料，让他们马上开始织布。")
          ),
        ],
        guide: "听听他们怎么说。",
        guideReaction: "等等……只有聪明的人才看得见？这话怎么听着有点怪怪的……",
      }),
      storyScene({
        id: "weaving",
        type: "weaving",
        chapter: "3 神秘的织布房",
        title: "神秘的织布房",
        image: scene("weaving-drag.jpg"),
        alternateImage: scene("weaving-room.jpg"),
        aspect: "2264 / 1536",
        units: [
          narration("两个裁缝摆出两架织布机，假装每天认真工作。"),
          narration(
            "他们不断向国王索要最好的生丝和金子，却偷偷把这些东西装进自己的口袋。",
            unitAudio("场景三", "他们不断向国王索要最好的生丝和金子，却偷偷把这些东西装进自己的口袋。")
          ),
          question("checkpoint-empty-loom"),
          narration(
            "两个裁缝摆出两架织布机，假装每天认真工作，但织布机上其实什么也没有。",
            unitAudio("场景三", "两个裁缝摆出两架织布机，假装每天认真工作，但织布机上其实什么也没有。")
          ),
          narration(
            "过了一段时间，国王带着大臣们来看布。",
            unitAudio("场景三", "过了一段时间，国王带着大臣们来看布。")
          ),
          dialogue(
            "裁缝",
            "陛下请看，多么漂亮的花纹和颜色！",
            unitAudio("场景三", "裁缝指着空空的织布机说：“陛下请看，多么漂亮的花纹和颜色！”")
          ),
          narration(
            "国王盯着织布机，却什么也看不见。他心里非常害怕。",
            unitAudio("场景三", "国王盯着织布机，却什么也看不见。他心里非常害怕：")
          ),
          dialogue(
            "国王心里",
            "难道我是个愚蠢的人？难道我不配当国王？",
            unitAudio("场景三", "“难道我是个愚蠢的人？难道我不配当国王？”")
          ),
          dialogue(
            "国王",
            "啊，真是太美了！我非常满意！",
            unitAudio("场景三", "为了不让别人发现，他只好说道：“啊，真是太美了！我非常满意！”")
          ),
          narration(
            "大臣们其实也什么都没看见，但他们同样不敢承认，纷纷称赞。",
            unitAudio("场景三", "大臣们其实也什么都没看见，但他们同样不敢承认，纷纷称赞")
          ),
          dialogue(
            "大臣们",
            "真漂亮！真精致！",
            unitAudio("场景三", "：“真漂亮！真精致！”")
          ),
          narration(
            "于是，国王决定让裁缝用这种“神奇的布”做一套新衣，在游行大典上穿。",
            unitAudio("场景三", "于是，国王决定让裁缝用这种“神奇的布”做一套新衣，在游行大典上穿。")
          ),
        ],
        guide: "看看织布机那里。",
      }),
      storyScene({
        id: "mirror",
        type: "mirror",
        chapter: "4 皇帝来看新衣",
        title: "皇帝来看新衣",
        image: scene("mirror.jpg"),
        revealImage: scene("mirror-truth.jpg"),
        aspect: "2264 / 1536",
        units: [
          narration(
            "游行前一天晚上，两个裁缝假装赶工。",
            unitAudio("场景四", "游行前一天晚上，两个裁缝假装赶工。")
          ),
          narration(
            "他们拿着剪刀在空气中裁剪，又拿着没有线的针假装缝衣服。",
            unitAudio("场景四", "他们拿着剪刀在空气中裁剪，又拿着没有线的针假装缝衣服。")
          ),
          dialogue(
            "裁缝",
            "陛下，您的新衣做好了！",
            unitAudio("场景四", "第二天，他们宣布：“陛下，您的新衣做好了！")
          ),
          dialogue(
            "裁缝",
            "它们轻得像蜘蛛网一样！",
            unitAudio("场景四", "它们轻得像蜘蛛网一样！”")
          ),
          narration(
            "裁缝让国王脱下原来的衣服，假装帮他穿上新衣。",
            unitAudio("场景四", "裁缝让国王脱下原来的衣服，假装帮他穿上新衣。")
          ),
          narration(
            "国王站在镜子前转了几圈。周围的人纷纷称赞。",
            unitAudio("场景四", "国王站在镜子前转了几圈。周围的人纷纷称赞：")
          ),
          dialogue(
            "众人",
            "太合身了！花纹真漂亮！这真是一套贵重的衣服！",
            unitAudio("场景四", "“太合身了！”“花纹真漂亮！”“这真是一套贵重的衣服！”")
          ),
          question("checkpoint-mirror-truth"),
          narration(
            "国王和骑士们什么都没有看见，却没有一个人敢说出来。",
            unitAudio("场景四", "国王和骑士们什么都没有看见，却没有一个人敢说出来。")
          ),
          narration(
            "准备托着衣服后裾的大臣，也只好伸出双手。",
            unitAudio("场景四", "准备托着衣服后裾的大臣，也只好伸出双手")
          ),
          narration(
            "他们假装托着根本不存在的衣摆。",
            unitAudio("场景四", "假装托着根本不存在的衣摆。")
          ),
          narration("很快，游行就要开始了。"),
        ],
        guide: "看看镜子前的皇帝。",
      }),
      storyScene({
        id: "parade",
        type: "parade",
        chapter: "5 盛大游行",
        title: "盛大的游行",
        image: scene("parade.jpg"),
        aspect: "2264 / 1536",
        units: [
          narration(
            "国王就这样走上街头，开始了盛大的游行。",
            unitAudio("场景五", "国王就这样走上街头，开始了盛大的游行。")
          ),
          dialogue(
            "人群",
            "陛下的新衣真漂亮！多么合身啊！",
            unitAudio("场景五", "大家纷纷称赞：“陛下的新衣真漂亮！”“多么合身啊！”")
          ),
          question("checkpoint-parade-conformity"),
          narration(
            "街上的人看到国王后，都害怕自己被认为愚蠢或不称职，",
            unitAudio("场景五", "街上的人看到国王后，都害怕自己被认为愚蠢或不称职，")
          ),
          narration(
            "虽然他们什么都没有看见，却没有一个人愿意承认。",
            unitAudio("场景五", "虽然他们什么都没有看见，却没有一个人愿意承认。")
          ),
          narration(
            "所以没人敢说出真相。",
            unitAudio("场景五", "所以没人敢说出真相。")
          ),
          narration("人群里的小声疑问越来越多，可游行还在往前走。"),
          narration("就在所有人都称赞国王的新衣时，一个小孩子挤到了前面。"),
        ],
        guide: "听听人群的声音。",
      }),
      storyScene({
        id: "truth",
        type: "truth",
        chapter: "6 小孩说出真相",
        title: "可是……皇帝什么衣服也没穿呀！",
        image: scene("truth.jpg"),
        aspect: "2264 / 1536",
        units: [
          narration(
            "就在所有人都称赞国王的新衣时，一个小孩子突然大声说道。",
            unitAudio("场景六", "就在所有人都称赞国王的新衣时，一个小孩子突然大声说道：")
          ),
          dialogue(
            "小孩子",
            "可是国王什么衣服也没有穿呀！",
            unitAudio("场景六", "“可是国王什么衣服也没有穿呀！”")
          ),
          narration(
            "人群一下子安静了下来。",
            unitAudio("场景六", "人群一下子安静了下来")
          ),
          narration(
            "很快，人们开始小声议论：“他说得对……”“国王真的什么都没穿！”",
            unitAudio("场景六", "很快，人们开始小声议论：“他说得对……”“国王真的什么都没穿！")
          ),
          narration(
            "最后，所有人都喊了起来：“国王根本没有穿衣服！”",
            unitAudio("场景六", "最后，所有人都喊了起来：“国王根本没有穿衣服！")
          ),
          narration(
            "国王听见后，心里知道大家说的是对的。",
            unitAudio("场景六", "国王听见后，心里知道大家说的是对的。")
          ),
          narration(
            "但他仍然挺起胸膛，装出骄傲的样子，继续完成游行。",
            unitAudio("场景六", "但他仍然挺起胸膛，装出骄傲的样子，继续完成游行")
          ),
          narration(
            "跟在他身后的大臣们，也依然伸着双手。",
            unitAudio("场景六", "跟在他身后的大臣们，也依然伸着双手")
          ),
          narration(
            "托着那条根本不存在的衣服后裾。",
            unitAudio("场景六", "托着那条根本不存在的衣服后裾")
          ),
          question("checkpoint-final-reflection"),
        ],
        guide: "先听完人群的反应。",
        truthLine: "可是……皇帝什么衣服也没穿呀！",
      }),
    ],
  };
})();
