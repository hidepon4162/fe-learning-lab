# FE Classroom Quiz

## 先生用（ロックなし・プリセット保存可）
- https://<user>.github.io/<repo>/?qver=20260209

## 生徒用（授業：必ず最初から・自動開始）
- 条件式だけ：
  https://<user>.github.io/<repo>/?student=1&preset=conditionsOnly&fresh=1&autostart=1&qver=20260209

## 生徒用（自宅復習：続きから再開・自動開始）
- 条件式だけ：
  https://<user>.github.io/<repo>/?student=1&preset=conditionsOnly&autostart=1&qver=20260209

## パラメータ
- student=1 : 生徒ロック（設定変更不可）
- preset=... : 強制プリセット
- autostart=1 : 起動直後に開始
- fresh=1 : 必ず最初から（保存セッション破棄）
- qver=... : questions.json キャッシュ対策（更新反映用）