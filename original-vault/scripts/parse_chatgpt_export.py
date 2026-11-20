#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
parse_chatgpt_export.py
------------------------------------------------------------
把 ChatGPT 官方导出的 conversations.json 解析成可读的 Markdown，
供 self-knowledge-vault 的 raw/chatgpt/ 目录存档（只读原始层）。

特性：
- --list  : 只列出全部对话的 序号/日期/标题/消息数，不写文件，方便挑选
- --pick  : 按标题关键词挑选（逗号分隔，多个关键词是"或"关系）
- --search: 按标题关键词模糊匹配（同 --pick，语义更直观）
- --limit : 只取最近 N 段（按更新时间倒序）
- 默认/--all: 全量导出
- 自动处理：消息树遍历、多模态/工具消息过滤、文件名清洗、时间戳转换、UTF-8

用法示例（PowerShell，在知识库根目录运行）：
  python scripts/parse_chatgpt_export.py -i "C:/path/conversations.json" -o raw/chatgpt --list
  python scripts/parse_chatgpt_export.py -i "C:/path/conversations.json" -o raw/chatgpt --pick "自我,焦虑,职业"
  python scripts/parse_chatgpt_export.py -i "C:/path/conversations.json" -o raw/chatgpt --limit 5
  python scripts/parse_chatgpt_export.py -i "C:/path/conversations.json" -o raw/chatgpt --all
------------------------------------------------------------
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ChatGPT 导出时间是 UTC，输出时转成北京时间（UTC+8），可按需修改
TZ = timezone(timedelta(hours=8))

ILLEGAL_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\r\n\t]')


def ts_to_str(ts):
    """Unix 时间戳 -> 'YYYY-MM-DD HH:MM'（北京时间）；无法解析则返回占位。"""
    try:
        if ts is None:
            return "未知时间"
        return datetime.fromtimestamp(float(ts), tz=TZ).strftime("%Y-%m-%d %H:%M")
    except (ValueError, TypeError, OSError):
        return "未知时间"


def ts_to_date(ts):
    try:
        if ts is None:
            return "0000-00-00"
        return datetime.fromtimestamp(float(ts), tz=TZ).strftime("%Y-%m-%d")
    except (ValueError, TypeError, OSError):
        return "0000-00-00"


def sanitize_filename(name, max_len=60):
    """清洗成合法、不会过长的文件名。"""
    name = ILLEGAL_FILENAME_CHARS.sub("_", name or "").strip()
    name = re.sub(r"\s+", " ", name)
    if not name:
        name = "未命名对话"
    if len(name) > max_len:
        name = name[:max_len].rstrip()
    return name


def extract_text_from_parts(parts):
    """content.parts 里可能是字符串，也可能是多模态 dict（图像等），只提取文字。"""
    texts = []
    if not isinstance(parts, list):
        if isinstance(parts, str):
            return parts.strip()
        return ""
    for part in parts:
        if isinstance(part, str):
            texts.append(part)
        elif isinstance(part, dict):
            # 多模态里的文本块
            if part.get("content_type") == "text" and isinstance(part.get("parts"), list):
                texts.append(extract_text_from_parts(part["parts"]))
            elif "text" in part and isinstance(part["text"], str):
                texts.append(part["text"])
            # 图像/音频等非文本块，做个占位说明而不是报错
            elif part.get("content_type") in ("image_asset_pointer", "audio_transcription"):
                continue
    return "\n".join(t for t in texts if t).strip()


def linearize_messages(conversation):
    """
    从 mapping 树中按时间顺序提取 user/assistant 的文本消息。
    采用'收集所有有效消息节点 -> 按 create_time 稳定排序'的方式，
    对线性对话和'重新生成回复'的分支都足够稳健。
    """
    mapping = conversation.get("mapping") or {}
    messages = []
    for node in mapping.values():
        if not isinstance(node, dict):
            continue
        msg = node.get("message")
        if not msg:
            continue
        author = msg.get("author") or {}
        role = author.get("role")
        if role not in ("user", "assistant"):
            continue
        content = msg.get("content") or {}
        content_type = content.get("content_type", "text")
        # 只保留文本类内容，跳过 tool_calls / execution_output / tether 等
        if content_type not in ("text", "multimodal_text"):
            continue
        # 某些工具回灌的 user 消息（author.name 非空且是工具）跳过
        if role == "user" and author.get("name"):
            continue
        text = extract_text_from_parts(content.get("parts"))
        if not text:
            continue
        messages.append({
            "role": role,
            "text": text,
            "time": msg.get("create_time"),
        })
    # 稳定排序：时间为空的排最后，保持原始相对顺序
    messages.sort(key=lambda m: (m["time"] is None, m["time"] if m["time"] is not None else 0))
    return messages


def conversation_to_markdown(conv, index_no=None):
    """把单个 conversation dict 转成 Markdown 字符串。"""
    title = conv.get("title") or "未命名对话"
    conv_id = conv.get("id", "")
    created = ts_to_str(conv.get("create_time"))
    updated = ts_to_str(conv.get("update_time"))
    messages = linearize_messages(conv)

    lines = []
    lines.append("---")
    lines.append(f"title: {json.dumps(title, ensure_ascii=False)}")
    lines.append("platform: chatgpt")
    lines.append(f"source_id: {conv_id}")
    lines.append(f"created: {created}")
    lines.append(f"updated: {updated}")
    lines.append(f"message_count: {len(messages)}")
    lines.append("---")
    lines.append("")
    lines.append(f"# {title}")
    lines.append("")
    lines.append(f"> 来源：ChatGPT 导出 ｜ 创建：{created} ｜ 最后更新：{updated}")
    lines.append("")
    for m in messages:
        speaker = "🧑 我" if m["role"] == "user" else "🤖 ChatGPT"
        t = ts_to_str(m["time"])
        lines.append(f"## {speaker} ｜ {t}")
        lines.append("")
        lines.append(m["text"])
        lines.append("")
        lines.append("---")
        lines.append("")
    return "\n".join(lines), len(messages)


def select_conversations(convs, args):
    """根据参数筛选要导出的对话。"""
    # 先按更新时间倒序（最近的在前）
    convs_sorted = sorted(
        convs,
        key=lambda c: c.get("update_time") or 0,
        reverse=True,
    )

    keyword = args.pick or args.search
    if keyword:
        kws = [k.strip().lower() for k in keyword.split(",") if k.strip()]
        picked = []
        for c in convs_sorted:
            title = (c.get("title") or "").lower()
            if any(k in title for k in kws):
                picked.append(c)
        return picked

    if args.limit:
        return convs_sorted[: args.limit]

    # 默认全量
    return convs_sorted


def main():
    parser = argparse.ArgumentParser(description="把 ChatGPT 导出的 conversations.json 解析为 Markdown")
    parser.add_argument("-i", "--input", required=True, help="conversations.json 的路径")
    parser.add_argument("-o", "--output", default="raw/chatgpt", help="输出目录（默认 raw/chatgpt）")
    parser.add_argument("--list", action="store_true", help="只列出对话清单，不写文件")
    parser.add_argument("--pick", "--search", dest="pick", help="按标题关键词挑选，多个用英文逗号分隔")
    parser.add_argument("--limit", type=int, help="只导出最近 N 段")
    parser.add_argument("--all", action="store_true", help="全量导出")
    args = parser.parse_args()

    input_path = Path(args.input.strip().strip('"').strip("'"))
    if not input_path.exists():
        print(f"[错误] 找不到输入文件：{input_path}", file=sys.stderr)
        sys.exit(1)

    print(f"[读取] {input_path} ...")
    with input_path.open("r", encoding="utf-8") as f:
        convs = json.load(f)
    if not isinstance(convs, list):
        print("[错误] 导出文件格式异常：顶层不是数组。", file=sys.stderr)
        sys.exit(1)
    print(f"[信息] 共读取到 {len(convs)} 段对话。")

    if args.list:
        ordered = sorted(convs, key=lambda c: c.get("update_time") or 0, reverse=True)
        print("\n序号 | 最后更新 | 消息数 | 标题")
        print("-" * 70)
        for idx, c in enumerate(ordered, 1):
            n = len(linearize_messages(c))
            print(f"{idx:>4} | {ts_to_str(c.get('update_time'))} | {n:>4} | {c.get('title') or '未命名对话'}")
        print("\n提示：用 --pick \"关键词1,关键词2\" 或 --limit N 选择要导出的对话。")
        return

    selected = select_conversations(convs, args)
    if not selected:
        print("[提示] 没有匹配到任何对话，换个关键词试试，或用 --list 查看全部标题。")
        return

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    written, skipped = 0, 0
    used_names = {}
    for idx, conv in enumerate(selected, 1):
        md, nmsg = conversation_to_markdown(conv)
        if nmsg == 0:
            skipped += 1
            continue
        date = ts_to_date(conv.get("create_time"))
        base = sanitize_filename(conv.get("title"))
        fname = f"{date}-{base}.md"
        # 重名加序号
        if fname in used_names:
            used_names[fname] += 1
            stem = fname[:-3]
            fname = f"{stem}-{used_names[fname]}.md"
        else:
            used_names[fname] = 1
        (out_dir / fname).write_text(md, encoding="utf-8")
        written += 1
        print(f"[{idx}/{len(selected)}] 已写出：{fname}（{nmsg} 条消息）")

    print(f"\n[完成] 导出 {written} 段，跳过空对话 {skipped} 段。输出目录：{out_dir.resolve()}")


if __name__ == "__main__":
    main()
