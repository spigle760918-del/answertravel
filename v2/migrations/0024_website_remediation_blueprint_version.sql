alter table website_remediation_blueprints add column rules_version text not null default 'website-remediation-blueprint.v1' check(rules_version='website-remediation-blueprint.v1');
alter table website_remediation_blueprints alter column rules_version drop default;
