import re

with open('agentflow-visual/src/pages/WorkflowPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Define replacements - using raw strings to preserve the exact bytes
replacements = [
    ('鏈\u{27}瀹岃\u{80鍚\u{94}浣\u{96}滄祦', '未命名工作流'),
    ('杈撳叆', '输入'),
    ('杈撳嚭', '输出'),
    ('寮€濮嬫墽琛?..', '开始执行...'),
    ('寮€濮嬫墽琛€..', '开始执行...'),
    ('鑾峰彇杈撳叆', '获取输入'),
    ('鏉′欢', '条件'),
    ('鎵ц€ Agent', '执行 Agent'),
    ('鎵ц\u{92} Agent', '执行 Agent'),
    ('涓嶅瓨鍦€', '不存在'),
    ('涓嶅瓨鍦?;', '不存在'),
    ('涓嶅瓨鍦?', '不存在'),
    ('鎵ц€', '执行'),
    ('浠诲姟', '任务'),
    ('妯℃嫙', '模拟'),
    ('宸叉墽琛', '已执行'),
    ('宸叉墽琛€', '已执行'),
    ('杈撳叆:', '输入:'),
    ('鑺傜偣', '节点'),
    ('杩炴帴', '连接'),
    ('淇濆瓨', '保存'),
    ('杩愯€', '运行'),
    ('鎿嶄綔鎻愮ず', '操作提示'),
    ('鐐瑰嚮', '点击'),
    ('鑺傜偣绫诲瀷', '节点类型'),
    ('娣诲姞', '添加'),
    ('鎵撳紑', '打开'),
    ('閰嶇疆', '配置'),
    ('闈?澘', '面板'),
    ('鎷栧姩', '拖动'),
    ('杈圭紭', '边缘'),
    ('鍙抽敭', '右键'),
    ('鍒犻櫎', '删除'),
    ('鍏堝垱寤€', '先创建'),
    ('瀵硅緭鍏€', '对输入'),
    ('璇勪及涓?', '评估为'),
]

count = 0
for garbled, correct in replacements:
    if garbled in content:
        content = content.replace(garbled, correct)
        count += 1

with open('agentflow-visual/src/pages/WorkflowPage.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print(f'Fixed {count} replacements in WorkflowPage.tsx')
