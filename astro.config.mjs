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
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/Elarwei001/research_openclaw' }],
			sidebar: [
				{
					label: 'Overview',
					items: [
						{ label: 'Architecture Landscape', slug: 'index' },
					],
				},
				{
					label: 'Components',
					autogenerate: { directory: 'components' },
				},
				{
					label: 'Data Flows',
					autogenerate: { directory: 'data-flows' },
				},
				{
					label: 'Memory System',
					autogenerate: { directory: 'architecture/memory' },
				},
				{
					label: 'Security',
					autogenerate: { directory: 'architecture/security' },
				},
			],
		}),
	],
});
