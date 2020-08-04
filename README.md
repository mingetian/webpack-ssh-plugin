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
	remotePath: '', //remote dir
	user:{
		host:'',
		port:'',
		username:'',
		password:''
	},
	test: /\.js$/, //Reg if you do not set this option,default upload all files
	localDir: '' //local file or dir, default webpack output.path
})
...

```

### tips

if you need, you can new this plugin one more.
so you can deal diff dirs, upload to remote diff dirs.
