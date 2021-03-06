
const fs = require('fs');
const crypto = require('crypto');
const {promisify}  =require('util');
//只能处理文件切不适合和ssh2-sftp-client一起使用
// const readdirp = require('readdirp');
const chalk = require('chalk');
// const Client = require('ssh2').Client;
let Client = require('ssh2-sftp-client');
const makeDir = require('make-dir');
const path = require('path');
let sftp = new Client();

const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const exists = promisify(fs.exists);
require('events').EventEmitter.defaultMaxListeners = 0;

//上传之前对比文件有改动的上传服务器
const rootDir = '_hashFiles';
class PreloadCheck {
    constructor({localPath,remotePath,cacheDirectory=path.join(process.cwd(),'node_modules','.cache','ssh-Directory')}){
        this.localPath = localPath;
        this.sshCacheDirectory = cacheDirectory;
        this.remotePath = remotePath;
    }
    //检查缓存 没有就创建缓存
    async checkCache(cache){
        let needUploads;
        try{
            let caches = {};
            if(cache){
                caches = await this.readCache();
            }
            if(Object.prototype.toString.call(caches) != "[object Object]"){
                this.reWriteCache();
                caches = {};
            }
            needUploads = await this.diffCache(caches);
            // 刷新缓存
            if(cache){
                await this.reWriteCache(caches);
            }
        }catch(e){
            console.log(e);
        }
        return needUploads;
        

    }
    async reWriteCache(reCache = {}){
        // fs.createWriteStream(path.resolve(this.sshCacheDirectory,rootDir),{
        //     encoding: 'ascii'
        // });
        let readCacheFile;
        if(Array.isArray(reCache)){
            readCacheFile = await readFile(path.join(this.sshCacheDirectory,rootDir),{encoding:'utf8'});
            readCacheFile = JSON.parse(readCacheFile);
            reCache.forEach(errFile=>{
                if(readCacheFile[errFile])delete readCacheFile[errFile];
            })
            reCache = readCacheFile;
        }
        return await writeFile(path.join(this.sshCacheDirectory,rootDir),JSON.stringify(reCache));
        
    }
    async readCache(){
        let cacheJSON = JSON.stringify({});
        let cachePath = this.sshCacheDirectory;
        try{
            if(! await exists(this.sshCacheDirectory)){
                cachePath = await makeDir(this.sshCacheDirectory,{
                    mode: 0o777
                });
            }
            cacheJSON = await readFile(path.join(cachePath,rootDir),{encoding:'utf8'});
        }catch(e){
            console.log("缓存中未取到");
        }
        return JSON.parse(cacheJSON);
    }
    async diffCache(caches){
        let needUploads = [];
        try{
            await this.next(caches,'',needUploads);   
        }catch(e){
            console.log(e);
        }
        return needUploads;
    }
    async next(caches,restPath,needUploads) {
        let rootPath = path.join(this.localPath,restPath);
        let proms=[];
        let statObj = await stat(rootPath);
        if(statObj.isDirectory()){
            try{
                let outNames = await readdir(rootPath);
                proms = outNames.map(async t=>{
                    try{
                        let p = path.join(rootPath,t);
                        let remoteDir = path.join(this.remotePath,restPath);
                        let stats =await stat(p);
                        if(stats.isDirectory()){
                            let innerPath = path.join(restPath,t);
                            return await this.next(caches,innerPath,needUploads)
                        }else{
                            let hash = this.makeHash(p);
                            if(caches[p] !== hash){
                                needUploads.push({
                                    localFile:  p,
                                    filename: t,
                                    remoteDir
                                });
                                caches[p] = hash;
                                return ;
                            }
                        }
                    }catch(e){
                        console.log(e);
                    }
                });
            }catch(e){
                console.log(e);
            }
        }else{
          try{
            let hash = this.makeHash(rootPath);
            needUploads.push({
                localFile: rootPath,
                filename: path.basename(rootPath),
                remoteDir: this.remotePath
            });
            caches[rootPath] = hash;
          }catch(err){
            console.log(err);
          }
        }
        
       
        return await Promise.all(proms); 
    }
    // hash计算
    makeHash(pathFile){
        //从文件创建一个可读流
        // var stream = fs.createReadStream(pathFile);
        // var fsHash = crypto.createHash('md5');
        // stream.on('data', function(d) {
        //     fsHash.update(d);
        // });

        // stream.on('end', function() {
        //     var md5 = fsHash.digest('hex');
        //     console.log("文件的MD5是：%s", md5);
        // });
        var fileContent = fs.readFileSync(pathFile);
        var fsHash = crypto.createHash('md5');
        fsHash.update(fileContent);
        return fsHash.digest('hex');
    }
}

class WebpackSSHPlugins{
    constructor(options) {
        this.options=options;  
    }
    apply(compiler) {
        let localPath = compiler.options.output.path;
        let { remotePath ,user, localDir='./',cache = false,test} = this.options;
        const upload = async (compilation,callback) => {
            let checker = new PreloadCheck({
                localPath: path.join(localPath,localDir),
                cacheDirectory: this.options.cacheDirectory,
                remotePath
            });
            try{
                let checkout = await checker.checkCache(cache);
                let dirs,errFiles=[];
                if(!checkout.length)return console.log(chalk.blue('没有要更新的文件'));
                await sftp.connect(user);
                if(!await sftp.exists(remotePath)){
                    await sftp.mkdir(remotePath,true);
                }
                let fp = checkout.map(async file=>{
                    if(!file.filename)return;
                    file.remoteDir = file.remoteDir.replace(/\\/g,'/');
                    if(!await sftp.exists(file.remoteDir)){
                        return file.remoteDir;
                    }
                });
                fp = await Promise.all(fp);
                const dirsPath = [...new Set(fp.filter(p => p))];
                dirs = dirsPath.map(p=>sftp.mkdir(p,true));
                await Promise.all(dirs);
                const dirsChmod = dirsPath.map(p=>sftp.chmod(p, 0o777));
                await Promise.all(dirsChmod);
                if(test&&test instanceof RegExp)checkout = checkout.filter(val=>test.test(val.filename));
                await checkout.reduce(async (prom,file)=>{
                    let fileP =  file.localFile,ret;
                    await prom;
                    try{
                        file.filename = file.filename.replace(/\\/g,'/');
                        file.localFile = file.localFile.replace(/\\/g,'/');
                        ret = await sftp.fastPut(file.localFile,file.remoteDir + '/' + file.filename,{mode: 0o777});
                        console.log(chalk.green(file.localFile + '--->' + file.remoteDir + '/' + file.filename + '--->已上传'));
                    }catch(e){
                        errFiles.push(fileP);
                        console.log(chalk.red(e));    
                    }
                    return ret;
                },Promise.resolve());

                // checkout = checkout.map(async file=>{
                //     let fileP =  file.localFile;
                //     try{
                //         file.filename = file.filename.replace(/\\/g,'/');
                //         file.localFile = file.localFile.replace(/\\/g,'/');
                //         await sftp.fastPut(file.localFile,file.remoteDir + '/' + file.filename);
                //         console.log(chalk.green(file.localFile + '--->' + file.remoteDir + '/' + file.filename + '--->已上传'));
                //     }catch(e){
                //         errFiles.push(fileP);
                //         console.log(chalk.red(e));    
                //     }
                    
                // })
                // await Promise.all(checkout);
                await sftp.end();
                if(cache)checker.reWriteCache(errFiles);
                if(errFiles.length){
                    console.log(chalk.red("多个文件上传出错"));   
                }else{
                    console.log(chalk.green("全部上传结束"));   
                }
                
            }catch(e){
                await sftp.end();
                if(cache)checker.reWriteCache(); ;
                console.log(chalk.red(e));   
            }
            callback();
        }
        if(compiler.hooks){
            compiler.hooks.afterEmit.tapAsync('WebpackSSHPlugins', upload);
        }else{
            compiler.plugin('after-emit',upload)
        }
        
    }
}
module.exports=WebpackSSHPlugins;