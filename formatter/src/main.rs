mod options;
mod sqlfmt;

use anyhow::{Context, Result};
use clap::Parser;
use options::{IndentStyle, Options};
use std::fs;
use std::io::{self, Read};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(author, version, about = "Aspen SQLplus formatter", long_about = None)]
struct Cli {
    /// Input file(s) to format. If none provided, read from STDIN
    #[arg(value_name = "FILES", value_hint = clap::ValueHint::FilePath)]
    files: Vec<PathBuf>,

    /// Write result back to the file(s)
    #[arg(long)]
    write: bool,

    /// Print diff of changes
    #[arg(long)]
    diff: bool,

    /// Maximum line width
    #[arg(long, default_value_t = 88)]
    line_width: usize,

    /// Indentation spaces (2 or 4)
    #[arg(long, default_value_t = 2, value_parser = clap::value_parser!(u8).range(2..=4))]
    indent: u8,

    /// Force uppercase SQL keywords (true/false)
    #[arg(long, default_value_t = true, action = clap::ArgAction::Set)]
    uppercase_keywords: bool,
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    let indent_style = match cli.indent {
        2 => IndentStyle::Two,
        4 => IndentStyle::Four,
        _ => IndentStyle::Two,
    };

    let opts = Options {
        line_width: cli.line_width,
        indent: indent_style,
        uppercase_keywords: cli.uppercase_keywords,
    };

    if cli.files.is_empty() {
        let mut buffer = String::new();
        io::stdin().read_to_string(&mut buffer)?;
        let formatted = sqlfmt::format_sql(&buffer, &opts)?;
        print!("{}", formatted);
        return Ok(());
    }

    for path in cli.files.iter() {
        let input = fs::read_to_string(path)
            .with_context(|| format!("Failed to read file {}", path.display()))?;
        let formatted = sqlfmt::format_sql(&input, &opts)?;
        if cli.write {
            fs::write(path, &formatted)
                .with_context(|| format!("Failed to write file {}", path.display()))?;
        } else if cli.diff {
            let changes = similar::TextDiff::from_lines(&input, &formatted);
            for change in changes.iter_all_changes() {
                let sign = match change.tag() {
                    similar::ChangeTag::Delete => "-",
                    similar::ChangeTag::Insert => "+",
                    similar::ChangeTag::Equal => " ",
                };
                print!("{}{}", sign, change);
            }
        } else {
            print!("{}", formatted);
        }
    }

    Ok(())
}
