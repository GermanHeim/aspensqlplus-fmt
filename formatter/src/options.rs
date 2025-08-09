#[derive(Debug, Clone, Copy)]
pub enum IndentStyle {
    Two,
    Four,
}

#[derive(Debug, Clone, Copy)]
pub struct Options {
    pub line_width: usize,
    pub indent: IndentStyle,
    pub uppercase_keywords: bool,
}

impl Options {
    pub fn indent_width(&self) -> usize {
        match self.indent {
            IndentStyle::Two => 2,
            IndentStyle::Four => 4,
        }
    }
}
