<script>
	import { goto } from '$app/navigation';
	import { auth } from '$lib/auth.js';

	let authVal;
	auth.subscribe((v) => (authVal = v));

	$effect(() => {
		goto(authVal?.token ? '/profile' : '/login', { replaceState: true });
	});
</script>

<div class="container">
	<p>Redirigiendo...</p>
</div>
