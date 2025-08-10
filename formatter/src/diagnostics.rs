use regex::Regex;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub enum DiagnosticSeverity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone)]
pub struct Diagnostic {
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
    pub message: String,
    pub severity: DiagnosticSeverity,
    pub code: String,
}

#[derive(Debug, Clone)]
pub struct Variable {
    pub name: String,
    pub declaration_type: String, // DECLARE, SET, LOCAL
    pub line: usize,
    pub column: usize,
    pub end_column: usize,
}

pub fn analyze_variables(input: &str) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    let lines: Vec<&str> = input.lines().collect();

    // Regex to capture variable declarations: DECLARE var_name / SET var_name / LOCAL var_name
    let decl_regex =
        Regex::new(r"(?i)\b(DECLARE|SET|LOCAL)\s+([a-zA-Z_][a-zA-Z0-9_]*)").expect("Invalid regex");

    let mut variables: HashMap<String, Vec<Variable>> = HashMap::new();
    let mut all_variables: Vec<Variable> = Vec::new();

    // Find all variable declarations
    for (line_idx, line) in lines.iter().enumerate() {
        for captures in decl_regex.captures_iter(line) {
            if let (Some(decl_type), Some(var_name)) = (captures.get(1), captures.get(2)) {
                let variable = Variable {
                    name: var_name.as_str().to_string(),
                    declaration_type: decl_type.as_str().to_ascii_uppercase(),
                    line: line_idx + 1,           // 1-based line numbers
                    column: var_name.start() + 1, // 1-based column numbers
                    end_column: var_name.end() + 1,
                };

                let var_key = var_name.as_str().to_lowercase();
                variables
                    .entry(var_key.clone())
                    .or_insert_with(Vec::new)
                    .push(variable.clone());
                all_variables.push(variable);
            }
        }
    }

    // Check for duplicate declarations
    for (var_name, declarations) in &variables {
        if declarations.len() > 1 {
            // Mark all declarations after the first as duplicates
            for (i, var) in declarations.iter().enumerate() {
                if i > 0 {
                    // Skip the first declaration
                    diagnostics.push(Diagnostic {
                        line: var.line,
                        column: var.column,
                        end_line: var.line,
                        end_column: var.end_column,
                        message: format!("Variable '{}' has already been declared", var.name),
                        severity: DiagnosticSeverity::Error,
                        code: "duplicate-variable".to_string(),
                    });
                }
            }
        }
    }

    // Check for unused variables
    for variable in &all_variables {
        if !is_variable_used(input, &variable.name, &all_variables) {
            diagnostics.push(Diagnostic {
                line: variable.line,
                column: variable.column,
                end_line: variable.line,
                end_column: variable.end_column,
                message: format!("Unused variable '{}'", variable.name),
                severity: DiagnosticSeverity::Warning,
                code: "unused-variable".to_string(),
            });
        }
    }

    diagnostics
}

fn is_variable_used(input: &str, var_name: &str, all_variables: &[Variable]) -> bool {
    let usage_regex =
        Regex::new(&format!(r"(?i)\b{}\b", regex::escape(var_name))).expect("Invalid regex");

    let mut usage_count = 0;
    for _ in usage_regex.find_iter(input) {
        usage_count += 1;
    }

    // Count how many times this variable is declared
    let declaration_count = all_variables
        .iter()
        .filter(|v| v.name.to_lowercase() == var_name.to_lowercase())
        .count();

    // If usage count is greater than declaration count, then it's used
    usage_count > declaration_count
}

pub fn format_diagnostics(diagnostics: &[Diagnostic]) -> String {
    let mut output = String::new();

    for diagnostic in diagnostics {
        let severity_str = match diagnostic.severity {
            DiagnosticSeverity::Error => "error",
            DiagnosticSeverity::Warning => "warning",
            DiagnosticSeverity::Info => "info",
        };

        output.push_str(&format!(
            "{}:{}:{}: {}: {} [{}]\n",
            diagnostic.line,
            diagnostic.column,
            diagnostic.end_column,
            severity_str,
            diagnostic.message,
            diagnostic.code
        ));
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_duplicate_variable_detection() {
        let input = r#"
LOCAL i real;
SELECT * FROM table;
LOCAL i real;
"#;

        let diagnostics = analyze_variables(input);
        let duplicates: Vec<_> = diagnostics
            .iter()
            .filter(|d| d.code == "duplicate-variable")
            .collect();

        assert_eq!(duplicates.len(), 1);
        assert_eq!(
            duplicates[0].message,
            "Variable 'i' has already been declared"
        );
        assert_eq!(duplicates[0].severity, DiagnosticSeverity::Error);
    }

    #[test]
    fn test_unused_variable_detection() {
        let input = r#"
LOCAL unused_var real;
LOCAL used_var real;
SELECT used_var FROM table;
"#;

        let diagnostics = analyze_variables(input);
        let unused: Vec<_> = diagnostics
            .iter()
            .filter(|d| d.code == "unused-variable")
            .collect();

        assert_eq!(unused.len(), 1);
        assert_eq!(unused[0].message, "Unused variable 'unused_var'");
        assert_eq!(unused[0].severity, DiagnosticSeverity::Warning);
    }

    #[test]
    fn test_case_insensitive_detection() {
        let input = r#"
local i real;
LOCAL I real;
"#;

        let diagnostics = analyze_variables(input);
        let duplicates: Vec<_> = diagnostics
            .iter()
            .filter(|d| d.code == "duplicate-variable")
            .collect();

        assert_eq!(duplicates.len(), 1);
    }
}
