// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightClientMermaid from '@pasqal-io/starlight-client-mermaid';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			plugins: [starlightClientMermaid()],
			title: 'OpenClaw Research',
			defaultLocale: 'root',
			locales: {
				root: { label: 'English', lang: 'en' },
				'zh-cn': { label: '简体中文', lang: 'zh-CN' },
				ja: { label: '日本語', lang: 'ja' },
				fr: { label: 'Français', lang: 'fr' },
				de: { label: 'Deutsch', lang: 'de' },
				ru: { label: 'Русский', lang: 'ru' },
			},
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/Elarwei001/research_openclaw' }],
			sidebar: [
				{
					label: 'Overview',
					translations: {
						'zh-CN': '概述',
						ja: '概要',
						fr: 'Aperçu',
						de: 'Überblick',
						ru: 'Обзор',
					},
					items: [
						{ label: 'Architecture Landscape', slug: 'index', translations: {
							'zh-CN': '架构概览',
							ja: 'アーキテクチャ概要',
							fr: 'Paysage architectural',
							de: 'Architekturübersicht',
							ru: 'Обзор архитектуры',
						}},
					],
				},
				{
					label: 'Components',
					translations: {
						'zh-CN': '组件',
						ja: 'コンポーネント',
						fr: 'Composants',
						de: 'Komponenten',
						ru: 'Компоненты',
					},
					autogenerate: { directory: 'components' },
				},
				{
					label: 'Data Flows',
					translations: {
						'zh-CN': '数据流',
						ja: 'データフロー',
						fr: 'Flux de données',
						de: 'Datenflüsse',
						ru: 'Потоки данных',
					},
					autogenerate: { directory: 'data-flows' },
				},
				{
					label: 'Memory System',
					translations: {
						'zh-CN': '内存系统',
						ja: 'メモリシステム',
						fr: 'Système de mémoire',
						de: 'Speichersystem',
						ru: 'Система памяти',
					},
					autogenerate: { directory: 'architecture/memory' },
				},
				{
					label: 'Security',
					translations: {
						'zh-CN': '安全',
						ja: 'セキュリティ',
						fr: 'Sécurité',
						de: 'Sicherheit',
						ru: 'Безопасность',
					},
					autogenerate: { directory: 'architecture/security' },
				},
			],
		}),
	],
});
