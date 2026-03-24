# Node 版 AutoResearch 最小框架

这是一个模仿 `karpathy/autoresearch` 思路、并吸收 `uditgoenka/autoresearch` 里 “git is memory” 设计的简化版框架，但目标从“单文件训练实验”改成了“让 agent 在 `workspace/` 中持续改代码，然后自动评估、接受或回滚”。

它有三个核心约束：

- `prepare.js`：负责一次性准备工作区、状态目录和默认样例。
- `workspace/`：agent 只允许修改这里，所有候选代码都放在这里。
- `program.md`：写给 agent 的基础指令和目标。

这个版本使用 Node.js，不依赖 Python，也不绑定任何特定模型 API。你可以用 Codex、Claude、Pi 自己的 agent 外壳，甚至手动修改 `workspace/` 来跑这个循环。

## 目录结构

```text
.
├── autoresearch.config.json   # 评估命令、分数文件、目标方向
├── prepare.js                 # 初始化工作区和状态目录
├── program.md                 # 给 agent 的基础指令
├── run.js                     # 先提交实验，再评估，决定保留或 git revert
├── workspace/                 # agent 实际修改的目录
└── .autoresearch/             # 框架生成的运行状态和历史
```

运行后，`.autoresearch/` 下会生成：

- `.autoresearch/best.json`：当前最佳分数
- `.autoresearch/runs/<run-id>/run.json`：每轮运行记录

同时，git 历史也会成为实验日志的一部分：

- 成功实验会保留一条 `experiment:` commit
- 失败实验会先生成 `experiment:` commit，再由框架自动 `git revert`
- 因此失败尝试不会消失，而是会明确留在提交历史里
- 如果 `workspace/` 之前还没有进入 git，第一次成功评估会被当作 bootstrap，先建立 git 基线

## 快速开始

先准备默认工作区：

```bash
npm run prepare:workspace
```

然后执行一次评估：

```bash
npm run run
```

第一次运行时，只要评估成功，当前 `workspace/` 就会被接受为最佳版本。

## 它是怎么工作的

`run.js` 每次会做这几件事：

1. 检查 `workspace/` 是否有改动。
2. 如果有改动，先把这些改动提交成一条实验 commit。
3. 执行配置里的评估命令，默认是：

```bash
node evaluate.js
```

这个命令会在 `workspace/` 目录下执行。

4. 读取 `workspace/result.json`。
5. 对比 `.autoresearch/best.json` 里的历史最佳分数。
6. 如果更好，就保留这条实验 commit，并更新最佳分数。
7. 如果更差，或者评估失败，就自动执行 `git revert`。

默认规则是：`score` 越低越好。
如果你是从旧版“非 git 回滚”框架迁移过来，第一次运行会自动把当前 `workspace/` 作为 git 基线纳入历史。

默认 commit message 前缀配置在 [autoresearch.config.json](/Users/yixin/my/pi-autoresearch-agent/autoresearch.config.json)：

```json
{
  "commitPrefix": "experiment:"
}
```

## 默认样例

初始化后，`workspace/` 里会有一个很小的 demo：

- `solution.js`：待优化的实现
- `evaluate.js`：跑测试并写出 `result.json`
- `README.md`：工作区约定

这个 demo 只是为了说明接口长什么样。你真正使用时，通常会把它替换成你自己的代码任务。

## 如何接入你自己的代码任务

最关键的是让 `workspace/` 具备一个稳定的“评估入口”。

你可以这样改：

1. 把你希望 agent 修改的代码放进 `workspace/`。
2. 把默认的 `workspace/evaluate.js` 改成你自己的评估逻辑。
3. 确保评估结束后写出 `workspace/result.json`。

最小格式如下：

```json
{
  "score": 12.34,
  "summary": "可选，人类可读摘要"
}
```

如果你想让“分数越高越好”，修改 [autoresearch.config.json](/Users/yixin/my/pi-autoresearch-agent/autoresearch.config.json)：

```json
{
  "objective": "maximize"
}
```

## 怎么让 agent 使用它

你可以把 agent 限定为只看 `program.md`、`workspace/` 和最近 git 历史，然后反复执行下面这个循环：

1. 读取 `program.md`
2. 阅读 `workspace/` 当前代码
3. 阅读最近几条 `git log`，理解哪些实验有效
4. 做一次小改动
5. 运行 `node run.js`
6. 根据分数和 git 历史决定下一步

如果你用的是 Codex/Claude 一类 coding agent，一个很直接的提示词是：

```text
请先阅读 program.md，然后只修改 workspace/ 里的文件，做一个小实验，最后运行 node run.js。
```

## 常见用法

### 1. 做代码优化

把 `workspace/` 换成你的模块、脚本或者小项目，评估逻辑写成：

- 单元测试通过数
- benchmark 耗时
- lint/typecheck/测试的综合评分

例如：

- 测试失败数越少越好
- 平均耗时越低越好
- 成功率越高越好

### 2. 做 prompt / agent 工作流优化

你也可以把 `workspace/` 视为一个 agent 方案：

- `workspace/prompt.md`
- `workspace/tools.js`
- `workspace/evaluate.js`

这样 agent 每轮不只是改业务代码，也可以改提示词、规划策略、工具编排方式。

## 推荐约束

为了让这个框架更接近 autoresearch 的味道，建议你保持这些约束：

- agent 只改 `workspace/`
- 每轮只做一个小实验
- 评估逻辑固定，不要和候选实现一起频繁变
- 分数规则尽量单一明确
- 每轮都保留日志，方便第二天回看
- 每轮开始前先看最近的 `git log` 和 `git diff`

## 常用命令

初始化或重建默认工作区：

```bash
npm run prepare:workspace
```

强制把默认样例重新写回 `workspace/`：

```bash
npm run reset:workspace
```

执行一轮评估：

```bash
npm run run
```

## 后续你可以怎么扩展

这个版本故意很小，方便你先把循环跑起来。后面你可以继续加：

- 多个评估指标和加权总分
- 自动记录 diff 摘要
- 每轮实验说明模板
- 并行候选分支
- 接 OpenAI/Claude 的自动 agent 调度
- 自动生成日报或实验报告

如果你愿意，我下一步可以继续帮你把它扩成“真正自动调用模型、多轮自驱迭代”的版本。 
