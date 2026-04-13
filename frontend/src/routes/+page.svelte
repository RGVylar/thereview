<script>
	import { auth } from '$lib/auth.js';
	import { goto } from '$app/navigation';

	let authVal;
	auth.subscribe((v) => (authVal = v));

	$effect(() => {
		if (!authVal?.token) {
			goto('/login');
		} else {
			goto('/sessions');
		}
	});
</script>

<div class="container">
	<h1>🍿 The Review</h1>
	<p>Loading...</p>
</div>
