use anyhow::Result;
use regex::Regex;

use crate::options::Options;

const KEYWORDS: &[&str] = &[
    "select",
    "insert",
    "update",
    "delete",
    "from",
    "where",
    "group",
    "by",
    "order",
    "having",
    "limit",
    "offset",
    "join",
    "inner",
    "left",
    "right",
    "full",
    "outer",
    "on",
    "as",
    "and",
    "or",
    "not",
    "null",
    "is",
    "in",
    "exists",
    "case",
    "when",
    "then",
    "else",
    "end",
    "create",
    "table",
    "view",
    "function",
    "procedure",
    "if",
    "begin",
    "commit",
    "rollback",
    "union",
    "all",
    "distinct",
    "with",
    "over",
    "write",
    "partition",
    "into",
    "values",
    "return",
    "returns",
    "declare",
    "set",
    "local",
    "real",
    "integer",
    "function",
    "set",
    "write",
    "record",
    "do",
    "char",
    "abs",
    "max",
    "min",
    "timestamp",
    "update",
];

fn build_keyword_regex() -> Regex {
    let pattern = KEYWORDS
        .iter()
        .map(|k| regex::escape(k))
        .collect::<Vec<_>>()
        .join("|");
    Regex::new(&format!(r"(?i)\b(?:{})\b", pattern)).unwrap()
}

pub fn format_sql(input: &str, opts: &Options) -> Result<String> {
    let kw_re = build_keyword_regex();
    let mut s = input.to_string();

    if opts.uppercase_keywords {
        s = kw_re
            .replace_all(&s, |caps: &regex::Captures| caps[0].to_ascii_uppercase())
            .to_string();
    }

    // Normalize whitespace and indentation
    // - Collapse multiple spaces
    // - Ensure single space after commas and around operators
    // - Break lines on common clause boundaries when exceeding line width (basic heuristic)

    let mut lines = vec![];
    for raw_line in s.lines() {
        let mut line = raw_line.trim().to_string();

        // Space after comma
        line = Regex::new(r",\s*")
            .unwrap()
            .replace_all(&line, ", ")
            .into_owned();
        // Space around equals and comparison operators
        line = Regex::new(r"\s*([=<>!]+)\s*")
            .unwrap()
            .replace_all(&line, " $1 ")
            .into_owned();

        // Naive wrapping at clause boundaries
        let clause_breaks = [
            " SELECT ",
            " FROM ",
            " WHERE ",
            " GROUP BY ",
            " ORDER BY ",
            " HAVING ",
            " LIMIT ",
            " OFFSET ",
            " JOIN ",
            " INNER JOIN ",
            " LEFT JOIN ",
        ];
        if line.len() > opts.line_width {
            let mut out = String::new();
            let mut rest = line.clone();
            let indent = " ".repeat(opts.indent_width());
            let mut first = true;
            while rest.len() > opts.line_width {
                let mut split_at = None;
                for marker in &clause_breaks {
                    if let Some(pos) = rest.find(marker) {
                        if pos > 0 && pos < opts.line_width {
                            split_at = Some(pos);
                            break;
                        }
                    }
                }
                if split_at.is_none() {
                    // fallback: split at last comma before limit
                    if let Some(pos) = rest[..opts.line_width].rfind(',') {
                        split_at = Some(pos + 1);
                    }
                }
                let idx = split_at.unwrap_or(opts.line_width);
                let (head, tail) = rest.split_at(idx);
                if first {
                    out.push_str(head.trim_end());
                    out.push('\n');
                    first = false;
                } else {
                    out.push_str(&indent);
                    out.push_str(head.trim());
                    out.push('\n');
                }
                rest = tail.trim().to_string();
            }
            if !rest.is_empty() {
                if !first {
                    out.push_str(&indent);
                }
                out.push_str(&rest);
            }
            line = out;
        }

        lines.push(line);
    }

    // Basic indentation based on parentheses and block keywords
    let mut indented = String::new();
    let mut level = 0usize;
    for mut line in lines {
        let upper = line.to_ascii_uppercase();
        let trimmed = upper.trim_start();
        // decrease indent for END or closing paren
        if trimmed.starts_with("END") || trimmed.starts_with(")") {
            if level > 0 {
                level -= 1;
            }
        }
        let indent = " ".repeat(level * opts.indent_width());
        line = format!("{}{}", indent, line.trim());
        indented.push_str(&line);
        indented.push('\n');
        // increase indent for THEN, BEGIN, CASE, opening parenthesis
        if trimmed.starts_with("THEN")
            || trimmed.starts_with("BEGIN")
            || trimmed.starts_with("CASE")
            || line.contains('(')
        {
            level += 1;
        }
        // heuristic: reduce for single-line END
        if trimmed.starts_with("END ") || trimmed == "END" {
            if level > 0 {
                level = level.saturating_sub(1);
            }
        }
    }

    Ok(indented.trim_end().to_string())
}
