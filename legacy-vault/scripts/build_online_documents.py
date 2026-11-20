"""Build editable Feishu import documents from the vault; no personal claims are generated."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import json, re
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'online'
OUT.mkdir(exist_ok=True)
DAY = '2026-11-12'
CATEGORIES = [
    ('insights', '具体洞察', '某段对话中明确出现的新发现'),
    ('patterns', '反复出现的模式', '至少两条证据支持的重复倾向'),
    ('values', '价值观与动机', '在乎什么以及优先级如何变化'),
    ('questions', '持续追问', '尚未解决并值得继续探索的问题'),
    ('transitions', '认知转变', '有证据支持的转变前和转变后'),
    ('experiments', '行动实验', '假设 行动 预期 实际结果'),
    ('entities', '重要影响', '对认知有重要影响的人 书 概念 工具'),
]

def base(title, intro):
    d = Document()
    s=d.sections[0]
    s.page_width=Inches(8.5);s.page_height=Inches(11)
    s.top_margin=Inches(.75);s.bottom_margin=Inches(.75)
    s.left_margin=Inches(.85);s.right_margin=Inches(.85)
    for name in ['Normal','Title','Heading 1','Heading 2','Heading 3']:
        style=d.styles[name]
        style.font.name='Noto Sans CJK SC'
        style._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),'Noto Sans CJK SC')
        style.font.color.rgb=RGBColor(0,0,0)
        style.paragraph_format.space_before=Pt(0)
        style.paragraph_format.space_after=Pt(4)
        style.paragraph_format.line_spacing=1.05
    d.styles['Normal'].font.size=Pt(11)
    d.styles['Title'].font.size=Pt(26)
    d.styles['Heading 1'].font.size=Pt(17)
    d.styles['Heading 2'].font.size=Pt(12)
    d.styles['Heading 3'].font.size=Pt(11)
    for name in ['Heading 1','Heading 2','Heading 3']:
        d.styles[name].paragraph_format.space_before=Pt(9)
        d.styles[name].paragraph_format.space_after=Pt(4)
    for style in d.styles:
        for border in list(style._element.findall('.//'+qn('w:pBdr'))):
            border.getparent().remove(border)
    d.add_paragraph(title,'Title')
    d.add_paragraph(intro)
    return d

def table(d, headers, rows, widths=None):
    t=d.add_table(rows=1, cols=len(headers));t.alignment=WD_TABLE_ALIGNMENT.CENTER
    t.autofit=False
    if widths:
        for col,width in zip(t.columns,widths):col.width=Inches(width)
    for i,h in enumerate(headers):t.rows[0].cells[i].text=h
    for row in rows:
        cells=t.add_row().cells
        for i,v in enumerate(row):cells[i].text=str(v)
    for ri,row in enumerate(t.rows):
        for ci,c in enumerate(row.cells):
            c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if widths:c.width=Inches(widths[ci])
            pr=c._tc.get_or_add_tcPr()
            borders=OxmlElement('w:tcBorders')
            for edge in ['top','left','bottom','right']:
                b=OxmlElement('w:'+edge);b.set(qn('w:val'),'single');b.set(qn('w:sz'),'4');b.set(qn('w:color'),'D9D9D9');borders.append(b)
            pr.append(borders)
            sh=OxmlElement('w:shd');sh.set(qn('w:fill'),'DCE7F2' if ri==0 else ('F5F7FA' if ri%2==0 else 'FFFFFF'));pr.append(sh)
            margins=OxmlElement('w:tcMar')
            for edge in ['top','left','bottom','right']:
                m=OxmlElement('w:'+edge);m.set(qn('w:w'),'90');m.set(qn('w:type'),'dxa');margins.append(m)
            pr.append(margins)
            for p in c.paragraphs:
                p.paragraph_format.space_after=Pt(3)
                p.paragraph_format.space_before=Pt(3)
                for r in p.runs:r.font.size=Pt(10.5);r.bold=(ri==0)
    trpr=t.rows[0]._tr.get_or_add_trPr();repeat=OxmlElement('w:tblHeader');trpr.append(repeat)
    d.add_paragraph()
    return t

def clean(t):
    return t.replace('**','').replace('`','').replace('[[','').replace(']]','')

def markdown(d, text, skip_first_title=True):
    lines=text.splitlines();i=0;code=False;first=True
    while i<len(lines):
        line=lines[i].strip();i+=1
        if line.startswith('```'):
            code=not code;continue
        if not line or line=='---':continue
        if line.startswith('|') and not code:
            group=[line]
            while i<len(lines) and lines[i].strip().startswith('|'):
                group.append(lines[i].strip());i+=1
            rows=[[clean(c.strip()) for c in ln.strip('|').split('|')] for ln in group]
            rows=[r for r in rows if not all(re.fullmatch(r':?-+:?',c) for c in r)]
            if len(rows)>1:table(d,rows[0],rows[1:])
            continue
        if line.startswith('#') and not code:
            n=len(line)-len(line.lstrip('#'));title=clean(line[n:].strip())
            if n==1 and first and skip_first_title:first=False;continue
            first=False
            title=re.sub(r'[：:（）()—·/]+',' ',title).strip()
            d.add_heading(title,min(max(n-1,1),3));continue
        line=clean(line.lstrip('> ').strip())
        if line.startswith('- '):line=line[2:]
        d.add_paragraph(line)

def build():
    home=base('个人认知知识库工作台','把自我探索对话整理为有依据的认知页面，保留认识变化与行动结果。这里是长期访问入口，详细内容在飞书文档中编辑。')
    home.add_heading('当前进度',1)
    home.add_paragraph('原始对话 0 段，正式认知页面 0 页。七类模板和维护规则已准备；本稿待导入飞书，登录后创建实际文档链接。')
    home.add_heading('分类导航',1)
    table(home,['分类','收录标准'],[(title,desc) for _,title,desc in CATEGORIES],[1.8,5])
    home.add_paragraph('维护入口：个人认知知识库维护规则。新建页面：复制个人认知知识库七类模板中的对应章节。导入飞书后，将这两份文档的实际链接填入本段。')
    home.add_heading('当前版本的我',1).paragraph_format.page_break_before=True
    for name,prompt in [('一句话画像','待真实对话导入与审阅后填写。'),('活跃探索主题','待填写 最近三个月的三至五个主题及依据。'),('核心价值观','待填写 不根据模板示例预设价值观排序。'),('反复出现的模式','待填写 每个模式至少两条原始证据。'),('正在追问','待填写 尚未解决的问题和下一步。')]:
        home.add_heading(name,2);home.add_paragraph(prompt)
    home.add_heading('成长时间线',1)
    home.add_paragraph('尚无认知转变记录。只登记有转变前和转变后证据的节点；知识库搭建与文档导入写入操作日志，不计为个人认知成长。')
    home.add_heading('本次操作日志',1)
    home.add_paragraph(DAY+' 已读取完整知识库骨架，核对七类模板与维护规则；修复解析脚本，准备飞书导入文档。尚未导入真实聊天，未生成个人认知结论。')
    home.add_heading('下一次如何更新',1)
    home.add_paragraph('导入一段真实对话，AI先检索已有页面，再提出新增或补充建议。完成审阅后更新认知页；出现明确转变时更新成长时间线；每次处理都记录操作日志。')
    home.save(OUT/'01_个人认知知识库工作台.docx')

    rules=base('个人认知知识库维护规则','本规则用于维护飞书中的个人认知页面及其Markdown备份。每条结论需要原始证据，推断须标注，认识变化须保留。')
    rules.add_heading('在线维护约定',1)
    rules.add_paragraph('用户已要求将详细内容存入可编辑飞书文档。公开入口仅用于导航和系统介绍；真实对话与个人认知详情按各文档权限访问。原规则中的本地默认值，不阻止本次已授权的飞书存储。')
    rules.add_paragraph('飞书文档作为人工编辑的主要版本。AI每次更新前读取当前版本，先生成增量建议；不以旧Markdown覆盖飞书手动修改。Markdown备份标记导出时间。当前未配置后台同步任务，不声称自动同步。')
    rules.add_paragraph('Obsidian双链在飞书中替换为真实文档链接，保留页标识和来源标识。Dataview代码保留给本地副本使用，不在飞书中冒充可执行查询。')
    rules.add_heading('原始维护规则',1)
    markdown(rules,(ROOT/'AGENTS.md').read_text())
    rules.save(OUT/'02_个人认知知识库维护规则.docx')

    templates=base('个人认知知识库七类模板','新建认知页面时复制对应章节。以下均为待填写模板，不代表已经确认的个人经历、心理模式或价值观。')
    templates.add_heading('所有页面保留的记录字段',1)
    table(templates,['字段','填写要求'],[
        ('页面标识与类型','唯一标识 标题 七类中的一种'),('来源','原始文件路径 消息标识 关键原句 来源日期'),
        ('依据性质','extracted 用户明说 inferred AI推断 ambiguous 存在歧义'),
        ('置信度','high 明确且多次出现 medium 单次明确或较有依据的推断 low 待核实'),
        ('状态与时间','待审阅或已确认 创建日期 更新日期 适用时间'),('关联与演变','真实相关页面的飞书链接 旧结论与新结论及触发依据')],[1.6,5.2])
    templates.add_paragraph('未获得用户确认的AI推断，正文使用“可能”“待确认”等表述，不代写为用户已经认可的第一人称事实。置信度表示证据情况，不是心理判断的客观概率。')
    for folder,title,desc in CATEGORIES:
        templates.add_heading(title,1).paragraph_format.page_break_before=True
        templates.add_paragraph(desc+'。')
        raw=(ROOT/'wiki'/folder/'_template.md').read_text()
        body=raw.split('---',2)[2].strip()
        templates.add_paragraph('来源与状态：待填写。依据性质：待判定。置信度：待判定。')
        markdown(templates,body)
    templates.save(OUT/'03_个人认知知识库七类模板.docx')

    links={'status':'awaiting_feishu_login','documents':{name:None for name in ['home','rules','templates']},'published_url':None,'updated':DAY}
    (OUT/'links.json').write_text(json.dumps(links,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'outputs':[str(x) for x in sorted(OUT.glob('*.docx'))]},ensure_ascii=False))

if __name__=='__main__':build()
