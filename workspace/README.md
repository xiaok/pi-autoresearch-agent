# Workspace

这里是 agent 允许修改的工作区。

- `solution.js`：候选实现
- `evaluate.js`：评估脚本，必须输出 `result.json`

`result.json` 至少需要包含：

```json
{
  "score": 0
}
```

默认规则是分数越低越好。
