// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: 'OpenClaw Research',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/Elarwei001/research_openclaw' }],
			sidebar: [
				{
					label: 'Overview',
					items: [
						{ label: 'Introduction', slug: 'index' },
					],
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
