# Claude Plan Token Limits

## トークンリミットの計算

プラン名の数字は**Claude Proに対する倍率**を表しています：
- **Claude Pro**: 基準（1x）
- **Claude Pro Max5**: Proの5倍
- **Claude Pro Max20**: Proの20倍

## 各プランのトークンリミット（5時間ブロックあたり）

### Claude Pro Max20 ($200/month) 
- **実測値**: 約580,472トークン（ccusageによる確認）
- **倍率**: 20x Pro

### Claude Pro Max5 ($100/month)
- **計算値**: 約145,118トークン（580,472 ÷ 4）
- **倍率**: 5x Pro

### Claude Pro ($20/month)
- **計算値**: 約29,024トークン（580,472 ÷ 20）
- **倍率**: 1x (基準)

## トークンリミットの確認方法

各プランのユーザーは以下のコマンドで自分のトークンリミットを確認できます：

```bash
# 最近のブロックデータを確認
npx ccusage@latest blocks --recent --token-limit max

# 出力に「assuming XXX token limit」という表示を探す
```

## 設定方法

実際の値が判明したら、config.jsonで明示的に設定してください：

```json
{
  "ccsp": {
    "usageMonitoring": {
      "claudePlan": "pro",
      "tokenLimits": {
        "pro": 実測値をここに入力
      }
    }
  }
}
```

## 貢献のお願い

もしあなたがClaude ProまたはMax5プランをご利用の場合、実際のトークンリミットを教えていただけると助かります。Issue #191にコメントしていただくか、PRを送ってください。

## 注意事項

- Anthropicは公式にトークンリミットを公表していません
- ccusageは過去の使用履歴から推定値を算出しています
- 実際の値はプランや時期によって変動する可能性があります