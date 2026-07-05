# -*- coding: utf-8 -*-
with open('agentflow-visual/src/pages/WorkflowPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace remaining garbled strings
replacements = [
    ('鎵ц� Agent', '执行 Agent'),
    ('不存在?);', '不存在);'),
    ('不存在?;', '不存在);'),
    ('不存在?>', '不存在>'),
    ('不存在? )', '不存在)'),
    ('不存在?', '不存在'),
    ('瀵硅緭鍏?"', '对输入"'),
    ('璇勪及涓? ', '评估为 '),
    ('璇勪及涓?', '评估为'),
    ('宸ヤ綔娴佸凡保存', '工作流已保存'),
]

for garbled, correct in replacements:
    if garbled in content:
        content = content.replace(garbled, correct)
        print(f'Fixed: {garbled}')

with open('agentflow-visual/src/pages/WorkflowPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done!')
