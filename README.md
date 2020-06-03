### webpack build done, you want to upload files.
- new you can use this plugin. it help upload local files to remote.
### Install
npm install webpack-ssh-upload --save-dev

or

yarn add webpack-ssh-upload  --save-dev

### Usage
```
const WebpackSShUpload = require('webpack-ssh-upload');

...
new SSHPlugin({
	remotePath: '', remote dir
	user:{
		host:'',
		port:'',
		username:'',
		password:''
	},
	localDir: '' local file or dir
})
...

```